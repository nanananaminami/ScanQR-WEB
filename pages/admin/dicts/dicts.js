const auth = require('../../../utils/auth');

const DEFAULT_PROCESS_LIST = [
  '压印', '光刻', '镀AR', '镀Ti', '去胶撕膜', '去胶清洗', '切割',
  '冲压', '折弯', '焊接', '喷涂', '组装', '测试',
  '车削', '铣削', '磨削', '电镀', '包装',
  '注塑', 'CNC加工', '抛光', '清洗', '烘干', '打标', '目检', '全检', '成品入库'
];

Page({
  data: {
    loading: true,
    dicts: [],
    showEdit: false,
    editing: false,
    form: { dict_id: '', dict_name: '', options: '' },
    saving: false
  },

  onLoad() {
    if (!auth.requireLogin()) return;
    if (!auth.hasPerm('template_manage')) {
      wx.showToast({ title: '无权限', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.loadDicts();
  },

  loadDicts() {
    this.setData({ loading: true });
    auth.callWithAuth('getDictList').then((res) => {
      const result = res.result || {};
      if (result.success) {
        const dicts = result.dicts || [];
        this.setData({ dicts, loading: false });
        this.ensureProcessList(dicts);
      } else {
        this.setData({ loading: false });
        wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ loading: false });
    });
  },

  ensureProcessList(dicts) {
    const hasProcessList = dicts.some(d => d.dict_id === 'process_list');
    if (hasProcessList) return;

    wx.showLoading({ title: '初始化工序列表...' });
    auth.callWithAuth('adminSaveDict', {
      dict_id: 'process_list',
      dict_name: '工序列表',
      options: DEFAULT_PROCESS_LIST,
      is_new: true
    }).then((res) => {
      wx.hideLoading();
      const result = res.result || {};
      if (result.success) {
        auth.callWithAuth('getDictList').then((r) => {
          const r2 = r.result || {};
          this.setData({ dicts: r2.dicts || [] });
        }).catch(() => {});
      }
    }).catch(() => {
      wx.hideLoading();
    });
  },

  openCreate() {
    this.setData({
      showEdit: true,
      editing: false,
      form: { dict_id: '', dict_name: '', options: '' }
    });
  },

  editDict(e) {
    const d = this.data.dicts[e.currentTarget.dataset.index];
    this.setData({
      showEdit: true,
      editing: true,
      form: {
        dict_id: d.dict_id,
        dict_name: d.dict_name,
        options: (d.options || []).join('\n')
      }
    });
  },

  closeEdit() {
    this.setData({ showEdit: false });
  },

  onFormChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value || '' });
  },

  saveDict() {
    const { form, editing, saving } = this.data;
    if (saving) return;
    if (!form.dict_id || !form.dict_name) {
      wx.showToast({ title: '标识与名称必填', icon: 'none' });
      return;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(form.dict_id)) {
      wx.showToast({ title: '标识只能字母数字下划线', icon: 'none' });
      return;
    }
    const options = (form.options || '').split('\n').map(s => s.trim()).filter(s => s);
    if (options.length === 0) {
      wx.showToast({ title: '至少一个选项', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    auth.callWithAuth('adminSaveDict', {
      dict_id: form.dict_id,
      dict_name: form.dict_name,
      options: options,
      is_new: !editing
    }).then((res) => {
      wx.hideLoading();
      this.setData({ saving: false });
      const result = res.result || {};
      if (result.success) {
        wx.showToast({ title: '已保存', icon: 'success' });
        this.setData({ showEdit: false });
        this.loadDicts();
      } else {
        wx.showModal({ title: '保存失败', content: result.msg || '请重试', showCancel: false });
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ saving: false });
    });
  },

  deleteDict(e) {
    const d = this.data.dicts[e.currentTarget.dataset.index];
    wx.showModal({
      title: '删除字典',
      content: '确定删除字典「' + d.dict_name + '」？引用该字典的下拉字段将变为无选项。',
      confirmColor: '#e34d59',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中...' });
        auth.callWithAuth('adminDeleteDict', { dict_id: d.dict_id }).then((r) => {
          wx.hideLoading();
          const result = r.result || {};
          if (result.success) {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadDicts();
          } else {
            wx.showModal({ title: '删除失败', content: result.msg, showCancel: false });
          }
        }).catch(() => {
          wx.hideLoading();
        });
      }
    });
  },

  onPullDownRefresh() {
    this.loadDicts();
    wx.stopPullDownRefresh();
  }
});
