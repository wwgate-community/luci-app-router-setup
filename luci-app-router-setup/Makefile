# Copyright (C) 2026 wwGate
#
# This is free software, licensed under the Apache License, Version 2.0

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-router-setup
PKG_VERSION:=2.0.2
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=wwGate

LUCI_TITLE:=Initial router setup wizard
LUCI_PKGARCH:=all
LUCI_DEPENDS:= \
	+luci-base \
	+rpcd-mod-iwinfo \
	+ppp-mod-pppoe \
	+kmod-pptp \
	+ppp-mod-pptp \
	+kmod-l2tp \
	+kmod-l2tp-eth \
	+kmod-l2tp-ip \
	+kmod-pppol2tp \
	+xl2tpd \
	+kmod-nf-nathelper-extra

define Package/luci-app-router-setup/conffiles
/etc/config/routersetup
endef

define Package/luci-app-router-setup/postinst
#!/bin/sh
chmod +x "$${IPKG_INSTROOT}"/etc/init.d/routersetup 2>/dev/null
chmod +x "$${IPKG_INSTROOT}"/etc/uci-defaults/luci-app-router-setup 2>/dev/null
if [ -f "$${IPKG_INSTROOT}/usr/share/router-setup/i18n/router-setup.ru.lmo" ]; then
	mkdir -p "$${IPKG_INSTROOT}/usr/lib/lua/luci/i18n"
	cp "$${IPKG_INSTROOT}/usr/share/router-setup/i18n/router-setup.ru.lmo" \
		"$${IPKG_INSTROOT}/usr/lib/lua/luci/i18n/router-setup.ru.lmo"
fi
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache*
	rm -rf /tmp/luci-modulecache/
	/etc/init.d/rpcd reload 2>/dev/null
	find /www/luci-static/resources/view/routersetup \
		/www/luci-static/resources/routersetup -exec touch {} + 2>/dev/null
}
exit 0
endef

define Package/luci-app-router-setup/prerm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || rm -f /usr/lib/lua/luci/i18n/router-setup.ru.lmo
exit 0
endef

include $(TOPDIR)/feeds/luci/luci.mk

define Build/Prepare/luci-app-router-setup
	$(INSTALL_DIR) $(PKG_BUILD_DIR)/root/usr/share/router-setup/i18n
	-$(STAGING_DIR_HOST)/bin/po2lmo $(CURDIR)/po-ru/router-setup.po \
		$(PKG_BUILD_DIR)/root/usr/share/router-setup/i18n/router-setup.ru.lmo
endef

# call BuildPackage - OpenWrt buildroot signature
