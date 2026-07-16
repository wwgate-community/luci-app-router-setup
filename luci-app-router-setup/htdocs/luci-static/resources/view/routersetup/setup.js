'use strict';
'require view';
'require uci';
'require form';
'require ui';
'require rpc';

var callIwinfoScan = rpc.declare({
	object: 'iwinfo',
	method: 'scan',
	params: ['device'],
	nobatch: true,
	expect: { results: [] }
});

// Router model, same source the Status → Overview page uses (system board).
var callSystemBoard = rpc.declare({
	object: 'system',
	method: 'board'
});

// Convert a CIDR prefix length to a dotted-quad netmask
function prefixToMask(prefix) {
	var bits = 0xFFFFFFFF << (32 - prefix);
	return [bits >>> 24, (bits >>> 16) & 0xFF, (bits >>> 8) & 0xFF, bits & 0xFF].join('.');
}

function firstOf(value) {
	if (Array.isArray(value))
		return value[0] || '';
	return value || '';
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.changes(),
			uci.load('wireless'),
			uci.load('routersetup'),
			uci.load('network'),
			L.resolveDefault(callSystemBoard(), {})
		]);
	},

	addWanOptions: function(s) {
		var hasRadios = uci.sections('wireless', 'wifi-device').length > 0;
		var o;

		o = s.taboption('wan', form.ListValue, 'wan_proto', _('Protocol'));
		o.rmempty = false;
		o.default = 'dhcp';
		o.value('dhcp', _('DHCP client'));
		o.value('static', _('Static address'));
		o.value('pppoe', _('PPPoE'));
		o.value('l2tp', _('L2TP'));
		o.value('pptp', _('PPTP'));
		if (hasRadios)
			o.value('wifi', _('Wi-Fi from another router'));

		o = s.taboption('wan', form.Value, 'wan_mac', _('MAC Address'),
			_('Clone MAC if required by your provider'));
		o.depends('wan_proto', 'dhcp');
		o.depends('wan_proto', 'static');
		o.datatype = 'macaddr';
		o.default = uci.get('routersetup', 'default', 'hw_mac');
		// MAC пишем ТОЛЬКО в routersetup - применяет его init.d (set_wan_macaddr),
		// создавая при необходимости секцию network.device. Писать отсюда прямо в
		// network.wan.macaddr бессмысленно: apply_wan() начинается с
		// drop_wan_ifaces() -> `uci delete network.wan`, и значение исчезает
		// вместе с секцией; к тому же на interface-секции опция устарела.

		o = s.taboption('wan', form.Value, 'wan_ipaddr', _('IP address'));
		o.depends('wan_proto', 'static');
		o.datatype = 'ip4addr';
		o.rmempty = false;

		o = s.taboption('wan', form.Value, 'wan_netmask', _('Netmask'));
		o.depends('wan_proto', 'static');
		o.datatype = 'ip4addr';
		o.value('255.255.255.0');
		o.value('255.255.252.0');
		o.value('255.255.0.0');
		o.rmempty = false;

		o = s.taboption('wan', form.Value, 'wan_gateway', _('Gateway'));
		o.depends('wan_proto', 'static');
		o.datatype = 'ip4addr';
		o.rmempty = false;

		o = s.taboption('wan', form.Value, 'wan_pppoe_user', _('Username'));
		o.depends('wan_proto', 'pppoe');

		o = s.taboption('wan', form.Value, 'wan_pppoe_pass', _('Password'));
		o.depends('wan_proto', 'pppoe');
		o.password = true;

		this.addTunnelOptions(s, 'l2tp');
		this.addTunnelOptions(s, 'pptp');
		if (hasRadios)
			this.addWifiWanOptions(s);

		o = s.taboption('wan', form.DynamicList, 'wan_dns', _('Use custom DNS servers'),
			_('Leave empty to obtain automatically from the provider'));
		o.datatype = 'ip4addr';
		o.cast = 'string';

		o = s.taboption('wan', form.Flag, 'ipv6', _('Enable IPv6'));
	},

	addTunnelOptions: function(s, kind) {
		var o;

		o = s.taboption('wan', form.Value, 'wan_' + kind + '_server', _('Server'));
		o.depends('wan_proto', kind);
		o.rmempty = false;

		o = s.taboption('wan', form.Value, 'wan_' + kind + '_user', _('Username'));
		o.depends('wan_proto', kind);

		o = s.taboption('wan', form.Value, 'wan_' + kind + '_pass', _('Password'));
		o.depends('wan_proto', kind);
		o.password = true;
	},

	// --- WISP: uplink over another router's Wi-Fi ---------------------------

	// network picked in the scan dialog; wan_wifi_radio/wan_wifi_enc are
	// written from here on save (there is no visible widget for them)
	wispChoice: {},

	// effective radio/encryption for the SSID currently in the form: a fresh
	// pick from the scan dialog wins, the saved config counts only while the
	// SSID is unchanged, a manually typed network falls back to a guess
	wispMeta: function(section, section_id) {
		var ssid = section.formvalue(section_id, 'wan_wifi_ssid');
		var key = section.formvalue(section_id, 'wan_wifi_key');
		if (this.wispChoice.ssid && this.wispChoice.ssid === ssid)
			return { radio: this.wispChoice.radio, enc: this.wispChoice.enc };
		if (ssid && uci.get('routersetup', section_id, 'wan_wifi_ssid') === ssid)
			return {
				radio: uci.get('routersetup', section_id, 'wan_wifi_radio'),
				enc: uci.get('routersetup', section_id, 'wan_wifi_enc')
			};
		return { radio: null, enc: key ? 'psk2' : 'none' };
	},

	encFromScan: function(bss) {
		var e = bss.encryption || {};
		var auth = e.authentication || [], wpa = e.wpa || [];
		if (!e.enabled)
			return 'none';
		if (auth.indexOf('sae') !== -1)
			return (auth.indexOf('psk') !== -1) ? 'sae-mixed' : 'sae';
		if (wpa.indexOf(1) !== -1 && wpa.indexOf(2) !== -1)
			return 'psk-mixed';
		if (wpa.indexOf(1) !== -1)
			return 'psk';
		return 'psk2';
	},

	encLabel: function(enc) {
		return {
			none: _('Open'), psk: 'WPA', psk2: 'WPA2',
			'psk-mixed': 'WPA/WPA2', sae: 'WPA3', 'sae-mixed': 'WPA2/WPA3'
		}[enc] || enc;
	},

	handleWifiScan: function(section_id) {
		var self = this;
		var radios = uci.sections('wireless', 'wifi-device')
			.map(function(sec) { return sec['.name']; });

		ui.showModal(_('Searching for Wi-Fi networks…'), [
			E('p', { 'class': 'spinning' },
				_('Scanning the air, this takes a few seconds…'))
		]);

		Promise.all(radios.map(function(r) {
			return callIwinfoScan(r).then(function(list) {
				return (list || []).map(function(bss) {
					bss._radio = r;
					return bss;
				});
			}, function() { return []; });
		})).then(function(lists) {
			var all = [].concat.apply([], lists).filter(function(bss) {
				return bss.ssid;	/* hidden networks are unusable here */
			});

			all.sort(function(a, b) {
				return (b.signal || -100) - (a.signal || -100);
			});

			var seen = {}, nets = [];
			all.forEach(function(bss) {	/* strongest instance of each SSID */
				if (seen[bss.ssid])
					return;
				seen[bss.ssid] = true;
				nets.push(bss);
			});

			if (!nets.length) {
				ui.showModal(_('Select a Wi-Fi network'), [
					E('p', {}, _('No networks found. Make sure the other router is powered on and in range.')),
					E('div', { 'class': 'right' }, [
						E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel'))
					])
				]);
				return;
			}

			var rows = nets.map(function(bss) {
				var enc = self.encFromScan(bss);
				var q = (bss.quality && bss.quality_max)
					? Math.round(100 * bss.quality / bss.quality_max) + '%'
					: (bss.signal || 0) + ' dBm';
				var band = (bss.channel <= 14) ? _('2.4 GHz') : _('5 GHz');

				return E('tr', {
					'class': 'tr cbi-rowstyle-1',
					'style': 'cursor:pointer',
					'click': function() {
						self.wispChoice = { ssid: bss.ssid, radio: bss._radio, enc: enc };
						var el = self.wispSsidOpt.getUIElement(section_id);
						if (el)
							el.setValue(bss.ssid);
						ui.hideModal();
					}
				}, [
					E('td', { 'class': 'td' }, bss.ssid),
					E('td', { 'class': 'td' }, band),
					E('td', { 'class': 'td' }, q),
					E('td', { 'class': 'td' }, self.encLabel(enc))
				]);
			});

			ui.showModal(_('Select a Wi-Fi network'), [
				E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr table-titles' }, [
						E('th', { 'class': 'th' }, _('Network')),
						E('th', { 'class': 'th' }, _('Band')),
						E('th', { 'class': 'th' }, _('Signal')),
						E('th', { 'class': 'th' }, _('Security'))
					])
				].concat(rows)),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'btn', 'click': ui.hideModal }, _('Cancel'))
				])
			]);
		});
	},

	addWifiWanOptions: function(s) {
		var self = this, o;

		o = s.taboption('wan', form.Value, 'wan_wifi_ssid', _('Wi-Fi network to connect to'),
			_('The network of the other router that shares its internet'));
		o.depends('wan_proto', 'wifi');
		o.datatype = 'maxlength(32)';
		o.rmempty = false;
		self.wispSsidOpt = o;

		o = s.taboption('wan', form.Button, '_wifi_scan', ' ');
		o.depends('wan_proto', 'wifi');
		o.inputtitle = _('Search for networks…');
		o.inputstyle = 'action';
		o.onclick = function(ev, section_id) {
			return self.handleWifiScan(section_id);
		};

		o = s.taboption('wan', form.Value, 'wan_wifi_key', _('Password of that network'),
			_('Leave empty for an open network'));
		o.depends('wan_proto', 'wifi');
		o.password = true;
		o.datatype = 'wpakey';
		o.validate = function(section_id, value) {
			var meta = self.wispMeta(this.section, section_id);
			if (!value && meta.enc && meta.enc !== 'none')
				return _('This network is protected — enter its password');
			return true;
		};

		o = s.taboption('wan', form.Value, 'wan_wifi_radio');
		o.render = function() { return Promise.resolve(E('div')); };
		o.parse = function(section_id) {
			if (this.section.formvalue(section_id, 'wan_proto') !== 'wifi')
				return Promise.resolve(this.remove(section_id));
			var meta = self.wispMeta(this.section, section_id);
			if (meta.radio && meta.radio !== this.cfgvalue(section_id))
				return Promise.resolve(this.write(section_id, meta.radio));
			if (!meta.radio && this.cfgvalue(section_id))
				return Promise.resolve(this.remove(section_id));
			return Promise.resolve();
		};

		o = s.taboption('wan', form.Value, 'wan_wifi_enc');
		o.render = function() { return Promise.resolve(E('div')); };
		o.parse = function(section_id) {
			if (this.section.formvalue(section_id, 'wan_proto') !== 'wifi')
				return Promise.resolve(this.remove(section_id));
			var meta = self.wispMeta(this.section, section_id);
			if (meta.enc && meta.enc !== this.cfgvalue(section_id))
				return Promise.resolve(this.write(section_id, meta.enc));
			return Promise.resolve();
		};
	},

	addLanOptions: function(s) {
		var o;

		// forcewrite: cfgvalue below reflects the live network config, so
		// the form would otherwise consider the fields unchanged and never
		// save them into routersetup - apply would then get an address without
		// a netmask (netifd treats that as /32 and DHCP breaks)
		o = s.taboption('lan', form.Value, 'lan_ipaddr', _('Router IP address'));
		o.datatype = 'ip4addr';
		o.rmempty = false;
		o.forcewrite = true;
		o.cfgvalue = function(section_id) {
			var addr = firstOf(uci.get('network', 'lan', 'ipaddr'));
			if (addr)
				return addr.split('/')[0];
			return firstOf(uci.get('routersetup', section_id, 'lan_ipaddr')).split('/')[0];
		};

		o = s.taboption('lan', form.Value, 'lan_netmask', _('Netmask'));
		o.datatype = 'ip4addr';
		o.value('255.255.255.0');
		o.rmempty = false;
		o.forcewrite = true;
		o.cfgvalue = function(section_id) {
			var addr = firstOf(uci.get('network', 'lan', 'ipaddr'));
			if (addr.indexOf('/') !== -1)
				return prefixToMask(parseInt(addr.split('/')[1], 10));
			return uci.get('network', 'lan', 'netmask')
				|| uci.get('routersetup', section_id, 'lan_netmask')
				|| '255.255.255.0';
		};
	},

	addWifiOptions: function(s) {
		var o;

		o = s.taboption('wifi', form.Flag, 'unify_ssid', _('Same name for both Wi‑Fi bands'));
		o.default = o.disabled;
		o.rmempty = false;

		o = s.taboption('wifi', form.Value, 'wifi_ssid', _('Wi-Fi network name'));
		o.datatype = 'maxlength(32)';
		o.rmempty = false;
		o.depends('unify_ssid', '1');

		o = s.taboption('wifi', form.Value, 'wifi_key', _('Wi-Fi Password'));
		o.datatype = 'wpakey';
		o.password = true;
		o.rmempty = false;
		o.depends('unify_ssid', '1');

		o = s.taboption('wifi', form.Value, 'wifi_ssid2', _('Wi-Fi 2.4Ghz network name'));
		o.datatype = 'maxlength(32)';
		o.rmempty = false;
		o.depends('unify_ssid', '0');

		o = s.taboption('wifi', form.Value, 'wifi_key2', _('Wi-Fi 2.4Ghz Password'));
		o.datatype = 'wpakey';
		o.password = true;
		o.rmempty = false;
		o.depends('unify_ssid', '0');

		o = s.taboption('wifi', form.Value, 'wifi_ssid5', _('Wi-Fi 5Ghz network name'));
		o.datatype = 'maxlength(32)';
		o.rmempty = false;
		o.depends('unify_ssid', '0');

		o = s.taboption('wifi', form.Value, 'wifi_key5', _('Wi-Fi 5Ghz Password'));
		o.datatype = 'wpakey';
		o.password = true;
		o.rmempty = false;
		o.depends('unify_ssid', '0');
	},

	addExtraOptions: function(s) {
		var o;

		o = s.taboption('extra', form.Flag, 'hide_menu', _('Hide from menu'),
			_('Remove the Quick Setup entry from the LuCI menu. To bring it back, open System → Quick Setup.'));
		o.default = '0';
		o.rmempty = false;

		// Mark the setup as completed whenever the wizard is saved/applied.
		// Persisted as routersetup.default.setup_done=1 — survives a
		// keep-settings sysupgrade, so first-boot uci-defaults can tell an
		// already-configured router from a factory-fresh one.
		o = s.taboption('wan', form.Value, 'setup_done');
		o.render = function() { return Promise.resolve(E('div')); };
		o.parse = function(section_id) {
			if (this.cfgvalue(section_id) !== '1')
				return Promise.resolve(this.write(section_id, '1'));
			return Promise.resolve();
		};
	},

	handleSaveApply: function(ev, mode) {
		// When the user hides the wizard from the menu, this very route
		// disappears after apply, yet LuCI reloads the current URL (-> 404)
		// and the browser keeps a cached copy of the menu tree. Flush the
		// client menu cache and leave for the LuCI start page instead.
		document.addEventListener('uci-applied', function onApplied() {
			document.removeEventListener('uci-applied', onApplied);
			if (uci.get('routersetup', 'default', 'hide_menu') == '1') {
				ui.menu.flushCache();
				window.location = L.url('admin');
			}
		});

		return this.super('handleSaveApply', [ev, mode]);
	},

	render: function(data) {
		var hasWifi = uci.sections('wireless', 'wifi-device').length > 0;
		var board = (data && data[4]) || {};
		var model = (board.model || '').trim();
		var m, s;

		// Put the model where the generic word "router" would be, e.g.
		// "…initial setup of your wwGate AX3000".
		var descr = model
			? _('Here you can perform a simple initial setup of your %s').format(model)
			: _('Here you can perform a simple initial setup of your router.');

		m = new form.Map('routersetup', [_('Initial Router Setup')], descr);

		s = m.section(form.NamedSection, 'default', 'routersetup');
		s.addremove = false;

		s.tab('wan', _('Internet'), _('Select the protocol that matches your provider settings.'));
		s.tab('lan', _('Network'), _('Specify the router IP address'));
		if (hasWifi)
			s.tab('wifi', _('Wi-Fi'), _('Set the desired Wi-Fi name and password.'));
		s.tab('extra', _('Options'));

		this.addWanOptions(s);
		this.addLanOptions(s);
		if (hasWifi)
			this.addWifiOptions(s);
		this.addExtraOptions(s);

		return m.render().then(function(node) {
			// LuCI themes lay out .cbi-value as a flexbox aligned to the top
			// (bootstrap: baseline, proton2025: flex-start), which leaves the
			// checkbox of a Flag sitting slightly above its label. Center just
			// the checkbox rows so the tick lines up with the text.
			node.insertBefore(E('style', { type: 'text/css' },
				'.cbi-value:has(.cbi-value-field input[type="checkbox"]){align-items:center}' +
				'.cbi-value:has(.cbi-value-field input[type="checkbox"])>.cbi-value-title{padding-top:0}' +
				'.routersetup-brand{display:flex;align-items:center;gap:16px;padding:4px 0 12px}' +
				'.routersetup-brand-logo{height:56px;width:auto;flex-shrink:0}' +
				'.routersetup-brand-text{min-width:0}' +
				'.routersetup-brand-text>h2{margin:0 0 2px}' +
				'.routersetup-brand-text>.cbi-map-descr{margin:0}'
			), node.firstChild);

			// One-row branding: logo on the left, the map title + description
			// stacked to the right of it.
			// The map title is the only <h2> (sections use <h3>), so the first
			// match is safe regardless of how the theme nests the map header.
			var title = node.querySelector('h2');
			var desc  = node.querySelector('.cbi-map-descr');
			var textCol = E('div', { 'class': 'routersetup-brand-text' });
			if (title) textCol.appendChild(title);
			if (desc)  textCol.appendChild(desc);
			node.insertBefore(E('div', { 'class': 'routersetup-brand' }, [
				E('img', {
					'class': 'routersetup-brand-logo',
					'src': L.resource('routersetup/logo.png'),
					'alt': ''
				}),
				textCol
			]), node.firstChild);
			return node;
		});
	}
});
