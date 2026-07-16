'use strict';
'require view';
'require form';
'require uci';
'require ui';

// Shown under System → Quick Setup, but only while the wizard is hidden from
// the menu (hide_menu=1, see menu.d). Unchecking "Hide from menu" and applying
// flips it back to 0 so the main "Quick Setup" entry reappears — no CLI needed.
// It is a real form.Map so it goes through the standard Save&Apply flow.
return view.extend({
	load: function() {
		return uci.load('routersetup');
	},

	render: function() {
		var m, s, o;

		m = new form.Map('routersetup', _('Quick Setup'),
			_('The Quick Setup wizard is currently hidden from the LuCI menu.'));

		s = m.section(form.NamedSection, 'default', 'routersetup');
		s.addremove = false;

		o = s.option(form.Flag, 'hide_menu', _('Hide from menu'),
			_('Uncheck and apply to bring Quick Setup back to the main menu.'));
		o.default = '0';
		o.rmempty = false;

		return m.render();
	},

	handleSaveApply: function(ev, mode) {
		// Same trick as the wizard's Options tab: once the flag is applied this
		// very route disappears, and LuCI would reload the current (now gone)
		// URL and 404. Flush the client menu cache and leave for the LuCI start
		// page instead — the restored "Quick Setup" entry is then in the menu.
		document.addEventListener('uci-applied', function onApplied() {
			document.removeEventListener('uci-applied', onApplied);
			if (uci.get('routersetup', 'default', 'hide_menu') != '1') {
				ui.menu.flushCache();
				window.location = L.url('admin');
			}
		});

		return this.super('handleSaveApply', [ev, mode]);
	}
});
