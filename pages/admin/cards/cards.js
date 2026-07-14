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
    // 建卡表单
    showCreate: false,
    templates: [],
    createForm: { card_no: '', prod_name: '', template_id: '' },
    createTemplateName: '',
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
    // 先拉取模板列表
    auth.callWithAuth('getTemplateList').then((res) => {
      const result = res.result || {};
      if (!result.success || !result.templates || result.templates.length === 0) {
        wx.showModal({ title: '暂无模板', content: '请先在「流程卡模板管理」中创建模板', showCancel: false });
        return;
      }
      this.setData({
        templates: result.templates,
        showCreate: true,
        createForm: {
          card_no: this.suggestCardNo(),
          prod_name: '',
          template_id: ''
        },
        createTemplateName: ''
      });
    }).catch(() => {
      wx.showToast({ title: '加载模板失败', icon: 'none' });
    });
  },

  suggestCardNo() {
    const d = new Date();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const ymd = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    const rand = Math.floor(Math.random() * 9000 + 1000);
    return 'WO-' + ymd + '-' + rand;
  },

  closeCreate() {
    this.setData({ showCreate: false });
  },

  onCreateFormChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['createForm.' + field]: e.detail.value || '' });
  },

  pickTemplate() {
    const templates = this.data.templates;
    wx.showActionSheet({
      itemList: templates.map(t => t.template_name + '（' + t.step_name + '）'),
      success: (res) => {
        const tpl = templates[res.tapIndex];
        this.setData({
          'createForm.template_id': tpl.template_id,
          createTemplateName: tpl.template_name + ' · ' + tpl.step_name
        });
      }
    });
  },

  submitCreate() {
    const { createForm, creating } = this.data;
    if (creating) return;
    if (!createForm.card_no || !createForm.prod_name || !createForm.template_id) {
      wx.showToast({ title: '卡号、产品名、模板必填', icon: 'none' });
      return;
    }
    this.setData({ creating: true });
    wx.showLoading({ title: '创建中...' });
    auth.callWithAuth('adminCreateCard', {
      card_no: createForm.card_no.trim(),
      prod_name: createForm.prod_name.trim(),
      template_id: createForm.template_id
    }).then((res) => {
      wx.hideLoading();
      this.setData({ creating: false });
      const result = res.result || {};
      if (result.success) {
        const cardNo = result.card_no;
        this.setData({ showCreate: false, statusFilter: '加工中' });
        wx.showModal({
          title: '建卡成功',
          content: '流程卡「' + cardNo + '」已创建，是否立即生成二维码？',
          confirmText: '生成二维码',
          cancelText: '关闭',
          success: (r) => {
            if (r.confirm) {
              wx.navigateTo({ url: '/pages/qr-gen/qr-gen?card_no=' + encodeURIComponent(cardNo) });
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
      content: '将强行释放流程卡「' + card.card_no + '」的占用锁（当前持有人：' + (card.locked_by || '未知') + '），对方未提交的数据将丢失。确认继续？',
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

  // 卡片操作菜单：追溯 / 强制解锁 / 完工 / 作废 / 恢复加工
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
          wx.navigateTo({ url: '/pages/admin/trace/trace?card_no=' + encodeURIComponent(card.card_no) });
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
    wx.showModal({
      title: actionText + '确认',
      content: '确定将流程卡「' + card.card_no + '」' + actionText + '？',
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
    const cardNo = e.currentTarget.dataset.cardNo;
    wx.navigateTo({ url: '/pages/admin/trace/trace?card_no=' + encodeURIComponent(cardNo) });
  },

  onPullDownRefresh() {
    this.loadCards();
    wx.stopPullDownRefresh();
  }
});
