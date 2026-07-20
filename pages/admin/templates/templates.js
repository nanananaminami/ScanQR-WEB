const auth = require('../../../utils/auth');

Page({
  data: {
    loading: true,
    templates: []
  },

  onLoad() {
    if (!auth.requireLogin()) return;
    if (!auth.hasPerm('template_manage')) {
      wx.showToast({ title: '无权限', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.loadTemplates();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
    }
  },

  loadTemplates() {
    this.setData({ loading: true });
    auth.callWithAuth('getTemplateList').then((res) => {
      const result = res.result || {};
      if (result.success) {
        const templates = (result.templates || []).map(t => ({
          ...t,
          headerCount: (t.header_fields || []).length,
          detailCount: (t.detail_fields || []).length,
          totalFields: (t.header_fields || []).length + (t.detail_fields || []).length,
          headerSummary: (t.header_fields || []).slice(0, 3).map(f => f.label).join(' · ') + ((t.header_fields || []).length > 3 ? ' ...' : ''),
          detailSummary: (t.detail_fields || []).slice(0, 3).map(f => f.label).join(' · ') + ((t.detail_fields || []).length > 3 ? ' ...' : ''),
          step_name: t.step_name || ''
        }));
        this.setData({ templates, loading: false });
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  createTemplate() {
    wx.navigateTo({ url: '/pages/admin/template-edit/template-edit' });
  },

  editTemplate(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/admin/template-edit/template-edit?template_id=' + encodeURIComponent(id) });
  },

  deleteTemplate(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    wx.showModal({
      title: '删除模板',
      content: '确定删除模板「' + name + '」？未被流转卡引用才可删除。',
      confirmColor: '#e34d59',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中...' });
        auth.callWithAuth('adminDeleteTemplate', { template_id: id }).then((r) => {
          wx.hideLoading();
          const result = r.result || {};
          if (result.success) {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadTemplates();
          } else {
            wx.showModal({ title: '删除失败', content: result.msg || '请重试', showCancel: false });
          }
        }).catch(() => {
          wx.hideLoading();
        });
      }
    });
  },

  goDicts() {
    wx.navigateTo({ url: '/pages/admin/dicts/dicts' });
  },

  onPullDownRefresh() {
    this.loadTemplates();
    wx.stopPullDownRefresh();
  }
});
