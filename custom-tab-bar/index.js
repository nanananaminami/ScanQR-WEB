const ALL_TABS = [
  { pagePath: '/pages/admin/dashboard/dashboard', text: '看板', icon: 'app' },
  { pagePath: '/pages/admin/cards/cards', text: '在制', icon: 'view-list' },
  { pagePath: '/pages/admin/logs/logs', text: '日志', icon: 'calendar' },
  { pagePath: '/pages/scan/scan', text: '扫码', icon: 'scan' },
  { pagePath: '/pages/admin/profile/profile', text: '我的', icon: 'user' }
];

Component({
  data: {
    selected: 0,
    role: '',
    list: []
  },

  lifetimes: {
    attached() {
      this.refresh();
      const app = getApp();
      if (!app.globalData.roleReady) {
        app.globalData.roleCallbacks.push(() => this.refresh());
      }
    }
  },

  pageLifetimes: {
    show() {
      this.refresh();
    }
  },

  methods: {
    refresh() {
      const app = getApp();
      const role = app.globalData.role || '';
      const list = role === 'admin'
        ? ALL_TABS
        : ALL_TABS.filter(t => t.text === '扫码' || t.text === '我的');
      this.setData({ role, list });
      this.syncSelected();
    },

    syncSelected() {
      const pages = getCurrentPages();
      if (!pages.length) return;
      const route = pages[pages.length - 1].route;
      const list = this.data.list;
      for (let i = 0; i < list.length; i++) {
        const path = list[i].pagePath.replace(/^\//, '');
        if (path === route) {
          this.setData({ selected: i });
          return;
        }
      }
    },

    onTap(e) {
      const index = e.currentTarget.dataset.index;
      wx.switchTab({ url: this.data.list[index].pagePath });
    }
  }
});
