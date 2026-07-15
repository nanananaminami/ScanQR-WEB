const auth = require('../../utils/auth');

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
    const orderNo = options.order_no ? decodeURIComponent(options.order_no) : '';
    if (!orderNo) {
      this.setData({ loading: false });
      return;
    }
    this.setData({ orderNo });
    this.loadCard(orderNo);
  },

  loadCard(orderNo) {
    const db = wx.cloud.database();
    db.collection('process_cards').where({ order_no: orderNo }).get().then((res) => {
      if (res.data.length === 0) {
        this.setData({ loading: false });
        wx.showToast({ title: '未找到流转卡', icon: 'none' });
        return;
      }
      const card = res.data[0];
      if (card.template_id) {
        db.collection('process_templates').where({ template_id: card.template_id }).get().then((tplRes) => {
          this.initDisplay(card, tplRes.data[0] || null);
        }).catch(() => {
          this.initDisplay(card, null);
        });
      } else {
        this.initDisplay(card, null);
      }
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  initDisplay(card, template) {
    this.setData({
      loading: false,
      card,
      template,
      headerFields: (template && template.header_fields) || [],
      headerData: card.header_data || {},
      detailFields: (template && template.detail_fields) || [],
      dynamicSteps: card.dynamic_steps || card.steps || [],
      warehousePersonnel: card.warehouse_personnel || '',
      warehouseDate: card.warehouse_date || ''
    });
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
          operator: operatorName
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
