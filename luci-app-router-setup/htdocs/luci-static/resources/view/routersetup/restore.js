'use strict';
'require view';
'require form';
'require uci';
'require ui';

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
