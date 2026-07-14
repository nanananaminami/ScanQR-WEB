const auth = require('../../../utils/auth');
const db = wx.cloud.database();

const STATUS_TABS = ['加工中', '已完工', '已作废'];

Page({
  data: {
    loading: true,
    cards: [],
    statusFilter: '加工中',
    statusTabs: STATUS_TABS,
    canCreate: false,
    showCreate: false,
    templates: [],
    selectedTemplate: null,
    selectedTemplateName: '',
    createForm: {
      order_no: '',
      stepsText: ''
    },
    headerForm: {},
    hasOrderNoField: false,
    creating: false
  },

  onLoad() {
    if (!auth.requireLogin()) return;
    this.setData({ canCreate: auth.hasPerm('card_list') });
    this.checkAndLoad();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
    }
    if (auth.hasPerm('card_list')) {
      this.loadCards();
    }
  },

  checkAndLoad() {
    if (!auth.hasPerm('card_list')) {
      wx.switchTab({ url: '/pages/scan/scan' });
      return;
    }
    this.loadCards();
  },

  loadCards() {
    this.setData({ loading: true });
    db.collection('process_cards')
      .where({ status: this.data.statusFilter })
      .orderBy('created_at', 'desc')
      .get()
      .then((res) => {
        const cards = res.data.map((c) => ({
          ...c,
          orderNo: c.order_no || c.card_no || '',
          projectLabel: this.getProjectLabel(c),
          stepCount: (c.dynamic_steps || c.steps || []).length || 0,
          lockedText: c.is_locked ? '锁定中' : '空闲',
          lockTimeText: c.lock_time ? this.formatTime(c.lock_time) : '-',
          statusTheme: c.status === '已完工' ? 'success' : (c.status === '已作废' ? 'danger' : 'primary')
        }));
        this.setData({ cards, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },

  getProjectLabel(card) {
    const hd = card.header_data || {};
    const projectName = card.project_name || hd.project_name || '';
    return projectName || card.order_no || '';
  },

  buildHeaderForm(headerFields, existing) {
    const form = {};
    headerFields.forEach(f => {
      const existingVal = existing[f.field_name];
      if (existingVal !== undefined && existingVal !== null && existingVal !== '') {
        form[f.field_name] = existingVal;
      } else if (f.default) {
        form[f.field_name] = f.default;
      } else {
        form[f.field_name] = f.type === 'number' ? 0 : '';
      }
      form['__dictOpt_' + f.field_name] = f.options || [];
    });
    return form;
  },

  formatTime(t) {
    if (!t) return '-';
    const d = new Date(t);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return d.getMonth() + 1 + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  },

  onStatusTabChange(e) {
    this.setData({ statusFilter: e.currentTarget.dataset.status });
    this.loadCards();
  },

  // ===== 建卡 =====
  openCreate() {
    auth.callWithAuth('getTemplateList').then((res) => {
      const result = res.result || {};
      if (!result.success || !result.templates || result.templates.length === 0) {
        wx.showModal({ title: '暂无模板', content: '请先在「流程卡模板管理」中创建模板', showCancel: false });
        return;
      }
      this.setData({
        templates: result.templates,
        showCreate: true,
        selectedTemplate: null,
        selectedTemplateName: '',
        createForm: { order_no: '', stepsText: '' },
        headerForm: {},
        hasOrderNoField: false
      });
    }).catch(() => {
      wx.showToast({ title: '加载模板失败', icon: 'none' });
    });
  },

  closeCreate() {
    this.setData({ showCreate: false });
  },

  pickTemplate() {
    const templates = this.data.templates;
    wx.showActionSheet({
      itemList: templates.map(t => t.template_name),
      success: (res) => {
        const tpl = templates[res.tapIndex];
        this.resolveTemplateSelects(tpl);
      }
    });
  },

  resolveTemplateSelects(tpl) {
    const selectFields = (tpl.header_fields || []).concat(tpl.detail_fields || []).filter(f => f.type === 'select' && f.dict_id && (!f.options || f.options.length === 0));
    const hasOrderNoField = (tpl.header_fields || []).some(f => f.field_name === 'order_no');
    if (selectFields.length === 0) {
      const headerForm = this.buildHeaderForm(tpl.header_fields || [], {});
      this.setData({ selectedTemplate: tpl, selectedTemplateName: tpl.template_name, headerForm, hasOrderNoField });
      return;
    }
    auth.callWithAuth('getDictList').then((res) => {
      const result = res.result || {};
      const dicts = result.dicts || [];
      const dictMap = {};
      dicts.forEach(d => { dictMap[d.dict_id] = d.options || []; });
      selectFields.forEach(f => {
        if (dictMap[f.dict_id]) f.options = dictMap[f.dict_id];
      });
      const headerForm = this.buildHeaderForm(tpl.header_fields || [], {});
      this.setData({
        selectedTemplate: tpl,
        selectedTemplateName: tpl.template_name,
        headerForm,
        hasOrderNoField
      });
    }).catch(() => {
      const headerForm = this.buildHeaderForm(tpl.header_fields || [], {});
      this.setData({ selectedTemplate: tpl, selectedTemplateName: tpl.template_name, headerForm, hasOrderNoField });
    });
  },

  onCreateFormChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['createForm.' + field]: e.detail.value || '' });
  },

  onHeaderFormChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['headerForm.' + field]: e.detail.value || '' });
  },

  pickHeaderSelect(e) {
    const field = e.currentTarget.dataset.field;
    const options = this.data.headerForm['__dictOpt_' + field] || [];
    if (options.length === 0) {
      wx.showToast({ title: '无选项', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: options,
      success: (res) => {
        this.setData({ ['headerForm.' + field]: options[res.tapIndex] });
      }
    });
  },

  fillHeaderTime(e) {
    const field = e.currentTarget.dataset.field;
    const now = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const timeStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    this.setData({ ['headerForm.' + field]: timeStr });
    wx.showToast({ title: '已记录时间', icon: 'success', duration: 1000 });
  },

  submitCreate() {
    const { createForm, selectedTemplate, headerForm, hasOrderNoField, creating } = this.data;
    if (creating) return;
    if (!selectedTemplate) {
      wx.showToast({ title: '请选择模板', icon: 'none' });
      return;
    }
    // 工单号来源：模板自带 order_no 字段时取其值，否则取系统输入
    const orderNo = hasOrderNoField
      ? String(headerForm.order_no || '').trim()
      : (createForm.order_no || '').trim();
    if (!orderNo) {
      wx.showToast({ title: '工单号为必填', icon: 'none' });
      return;
    }
    const steps = createForm.stepsText.split('\n').filter(s => s.trim());
    if (steps.length === 0) {
      wx.showToast({ title: '请至少输入一道工序', icon: 'none' });
      return;
    }

    this.setData({ creating: true });
    wx.showLoading({ title: '创建中...' });
    auth.callWithAuth('adminCreateCard', {
      order_no: orderNo,
      template_id: selectedTemplate.template_id,
      header_data: headerForm,
      steps: steps
    }).then((res) => {
      wx.hideLoading();
      this.setData({ creating: false });
      const result = res.result || {};
      if (result.success) {
        const orderNo = result.order_no;
        this.setData({ showCreate: false, statusFilter: '加工中' });
        wx.showModal({
          title: '建卡成功',
          content: '流转卡「' + orderNo + '」已创建，是否立即生成二维码？',
          confirmText: '生成二维码',
          cancelText: '关闭',
          success: (r) => {
            if (r.confirm) {
              wx.navigateTo({ url: '/pages/qr-gen/qr-gen?order_no=' + encodeURIComponent(orderNo) });
            }
          }
        });
        this.loadCards();
      } else {
        wx.showModal({ title: '创建失败', content: result.msg || '请重试', showCancel: false });
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ creating: false });
      wx.showToast({ title: '创建失败', icon: 'none' });
    });
  },

  // ===== 卡片操作 =====
  confirmUnlock(e) {
    if (!auth.hasPerm('card_unlock')) {
      wx.showModal({ title: '无权限', content: '缺少 card_unlock 权限', showCancel: false });
      return;
    }
    const index = e.currentTarget.dataset.index;
    const card = this.data.cards[index];
    if (!card) return;

    wx.showModal({
      title: '强制解锁确认',
      content: '将强行释放流转卡「' + (card.order_no || card.card_no) + '」的占用锁（当前持有人：' + (card.locked_by || '未知') + '），对方未提交的数据将丢失。确认继续？',
      confirmText: '强制解锁',
      confirmColor: '#e34d59',
      success: (res) => {
        if (res.confirm) this.doForceUnlock(card);
      }
    });
  },

  doForceUnlock(card) {
    const session = auth.getSession() || {};
    const userName = (session.user && (session.user.real_name || session.user.username)) || '管理员';
    wx.showLoading({ title: '解锁中...' });
    auth.callWithAuth('adminForceUnlock', {
      card_id: card._id,
      user_name: userName
    }).then((res) => {
      wx.hideLoading();
      const result = res.result || {};
      if (result.success) {
        wx.showToast({ title: '已强制解锁', icon: 'success' });
        this.loadCards();
      } else {
        wx.showModal({ title: '解锁失败', content: result.msg || '请重试', showCancel: false });
      }
    }).catch(() => {
      wx.hideLoading();
      wx.showModal({ title: '解锁失败', content: '云函数调用异常', showCancel: false });
    });
  },

  cardActions(e) {
    const index = e.currentTarget.dataset.index;
    const card = this.data.cards[index];
    if (!card) return;

    const items = ['生命周期追溯'];
    if (card.is_locked && card.status === '加工中') items.push('强制解锁');
    if (card.status === '加工中') {
      items.push('标记完工');
      items.push('作废');
    } else {
      items.push('恢复加工');
    }

    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const action = items[res.tapIndex];
        if (action === '生命周期追溯') {
          const cardId = card.order_no || card.card_no;
          wx.navigateTo({ url: '/pages/admin/trace/trace?order_no=' + encodeURIComponent(cardId) });
        } else if (action === '强制解锁') {
          this.confirmUnlock({ currentTarget: { dataset: { index } } });
        } else if (action === '标记完工') {
          this.changeStatus(card, '已完工');
        } else if (action === '作废') {
          this.changeStatus(card, '已作废');
        } else if (action === '恢复加工') {
          this.changeStatus(card, '加工中');
        }
      }
    });
  },

  changeStatus(card, newStatus) {
    const actionText = newStatus === '已完工' ? '标记完工' : (newStatus === '已作废' ? '作废' : '恢复加工');
    const cardLabel = card.order_no || card.card_no;
    wx.showModal({
      title: actionText + '确认',
      content: '确定将流转卡「' + cardLabel + '」' + actionText + '？',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中...' });
        auth.callWithAuth('adminUpdateCardStatus', {
          card_id: card._id,
          new_status: newStatus
        }).then((r) => {
          wx.hideLoading();
          const result = r.result || {};
          if (result.success) {
            wx.showToast({ title: '已' + actionText, icon: 'success' });
            this.loadCards();
          } else {
            wx.showModal({ title: '操作失败', content: result.msg || '请重试', showCancel: false });
          }
        }).catch(() => {
          wx.hideLoading();
          wx.showToast({ title: '操作失败', icon: 'none' });
        });
      }
    });
  },

  goTrace(e) {
    const orderNo = e.currentTarget.dataset.orderNo;
    wx.navigateTo({ url: '/pages/admin/trace/trace?order_no=' + encodeURIComponent(orderNo) });
  },

  onPullDownRefresh() {
    this.loadCards();
    wx.stopPullDownRefresh();
  }
});
