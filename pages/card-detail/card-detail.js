const auth = require('../../utils/auth');
const { formatDateTime } = require('../../utils/time');

Page({
  data: {
    loading: true,
    card: null,
    template: null,
    orderNo: '',
    headerFields: [],
    headerData: {},
    detailFields: [],
    dynamicSteps: [],
    warehousePersonnel: '',
    warehouseDate: ''
  },

  onLoad(options) {
    if (!auth.requireLogin()) return;
    const orderNo = options.order_no ? decodeURIComponent(options.order_no) : '';
    if (!orderNo) {
      this.setData({ loading: false });
      return;
    }
    this.setData({ orderNo });
    this.loadCard(orderNo);
  },

  loadCard(orderNo) {
    auth.callWithAuth('getCardDetail', { order_no: orderNo }).then((res) => {
      const result = res.result || {};
      if (!result.success || !result.card) {
        this.setData({ loading: false });
        wx.showToast({ title: result.msg || '未找到流转卡', icon: 'none' });
        return;
      }
      const card = result.card;
      this.initDisplay(card, result.template || null);
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  initDisplay(card, template) {
    const steps = card.dynamic_steps || card.steps || [];
    this.setData({
      loading: false,
      card,
      template,
      headerFields: (template && template.header_fields) || [],
      headerData: card.header_data || {},
      detailFields: (template && template.detail_fields) || [],
      dynamicSteps: steps,
      warehousePersonnel: card.warehouse_personnel || '',
      warehouseDate: card.warehouse_date || ''
    });
  },

  getSlaText(prevStep, currentStep) {
    if (!prevStep || !prevStep.prod_completed_at || !currentStep || !currentStep.prod_started_at) return null;
    const prevTime = new Date(prevStep.prod_completed_at);
    const startTime = new Date(currentStep.prod_started_at);
    const minutes = Math.floor((startTime.getTime() - prevTime.getTime()) / 60000);
    if (minutes <= 0) return null;
    if (minutes >= 1440) {
      const d = Math.floor(minutes / 1440);
      const h = Math.floor((minutes % 1440) / 60);
      return d + '天' + (h > 0 ? h + '小时' : '');
    }
    if (minutes >= 60) {
      return Math.floor(minutes / 60) + '小时' + (minutes % 60) + '分';
    }
    return minutes + '分钟';
  },

  getStepStatusText(s) {
    const parts = [];
    if (s.prod_completed_at) parts.push('生产已完成(' + (s.prod_completed_by || '-') + ')');
    else if (s.prod_started_at) parts.push('生产中');
    else parts.push('未开始');
    if (s.qc_completed_at) parts.push('品质已完成');
    return parts.join(' · ');
  },

  viewQrCode() {
    wx.navigateTo({ url: '/pages/qr-gen/qr-gen?order_no=' + encodeURIComponent(this.data.orderNo) + '&auto=1' });
  },

  editCard() {
    const session = auth.getSession() || {};
    const operatorName = (session.user && (session.user.real_name || session.user.username)) || '管理员';
    wx.showLoading({ title: '加载中...' });
    auth.callWithAuth('getAndLockCard', {
      order_no: this.data.orderNo,
      user_name: operatorName
    }).then((res) => {
      wx.hideLoading();
      const result = res.result || {};
      if (result.success) {
        getApp().globalData.lockedCard = {
          cardData: result.cardData,
          templateData: result.templateData,
          operator: operatorName,
          match: result.match || null
        };
        wx.navigateTo({ url: '/pages/flow-card/flow-card?order_no=' + encodeURIComponent(this.data.orderNo) });
      } else {
        wx.showModal({ title: '无法编辑', content: result.msg || '操作失败', showCancel: false });
      }
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  goTrace() {
    wx.navigateTo({ url: '/pages/admin/trace/trace?order_no=' + encodeURIComponent(this.data.orderNo) });
  }
});
