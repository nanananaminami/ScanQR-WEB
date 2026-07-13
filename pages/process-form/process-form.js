const auth = require('../utils/auth');

Page({
  data: {
    loading: true,
    submitting: false,
    submitted: false,
    cardData: null,
    templateData: null,
    fields: [],
    formData: {},
    stepName: '',
    operatorName: ''
  },

  onLoad(options) {
    const cardNo = options.card_no ? decodeURIComponent(options.card_no) : '';
    const locked = getApp().globalData.lockedCard;

    if (locked && locked.cardData) {
      this.initForm(locked);
    } else if (cardNo) {
      this.refetchCard(cardNo);
    } else {
      this.setData({ loading: false });
    }
  },

  initForm(locked) {
    const { cardData, templateData, operator } = locked;
    const rawFields = (templateData && templateData.fields) || [];
    const fields = rawFields.map((f) => ({
      ...f,
      displayLabel: f.label + (f.unit ? ' (' + f.unit + ')' : '') + (f.required ? ' *' : '')
    }));
    const formData = {};
    fields.forEach((f) => {
      formData[f.field_name] = f.type === 'switch' ? false : '';
    });
    this.setData({
      loading: false,
      cardData,
      templateData,
      fields,
      formData,
      stepName: (templateData && templateData.step_name) || cardData.current_step || '',
      operatorName: operator || '操作员'
    });
  },

  refetchCard(cardNo) {
    wx.cloud.database().collection('process_cards').where({ card_no: cardNo }).get()
      .then((res) => {
        if (res.data.length > 0) {
          this.setData({
            loading: false,
            cardData: res.data[0],
            stepName: res.data[0].current_step || ''
          });
          wx.showToast({ title: '表单数据已过期，请重新扫码上锁', icon: 'none' });
        } else {
          this.setData({ loading: false });
        }
      })
      .catch(() => {
        this.setData({ loading: false });
      });
  },

  onInputChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ ['formData.' + field]: value });
  },

  submitAndUnlock() {
    const { fields, formData, cardData, operatorName, submitting } = this.data;
    if (submitting) return;

    for (const f of fields) {
      if (f.required) {
        const val = formData[f.field_name];
        if (val === undefined || val === null || val === '') {
          wx.showToast({ title: '请填写' + f.label, icon: 'none' });
          return;
        }
      }
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...' });

    auth.callWithAuth('submitAndUnlockCard', {
      card_no: cardData.card_no,
      card_id: cardData._id,
      form_data: formData,
      step_name: this.data.stepName,
      user_name: operatorName,
      cancelled: false
    }).then((res) => {
      wx.hideLoading();
      this.setData({ submitting: false });
      const result = res.result || {};
      if (result.success) {
        this.setData({ submitted: true });
        getApp().globalData.lockedCard = null;
        wx.showToast({ title: '提交成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 1500);
      } else {
        wx.showModal({ title: '提交失败', content: result.msg || '请重试', showCancel: false });
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showModal({ title: '提交失败', content: '云函数调用异常', showCancel: false });
    });
  },

  cancelAndUnlock() {
    const { cardData, operatorName, submitting } = this.data;
    if (submitting) return;

    wx.showModal({
      title: '放弃填报',
      content: '将放弃本次填报并释放流程卡锁，确定继续？',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ submitting: true });
        wx.showLoading({ title: '解锁中...' });
        auth.callWithAuth('submitAndUnlockCard', {
          card_no: cardData.card_no,
          card_id: cardData._id,
          form_data: {},
          step_name: this.data.stepName,
          user_name: operatorName,
          cancelled: true
        }).then(() => {
          wx.hideLoading();
          this.setData({ submitting: false, submitted: true });
          getApp().globalData.lockedCard = null;
          wx.showToast({ title: '已解锁', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 1000);
        }).catch(() => {
          wx.hideLoading();
          this.setData({ submitting: false });
          wx.navigateBack();
        });
      }
    });
  },

  onUnload() {
    if (this.data.submitted || !this.data.cardData) return;
    const { cardData, operatorName } = this.data;
    // 异步释放锁，不等待返回
    auth.callWithAuth('submitAndUnlockCard', {
      card_no: cardData.card_no,
      card_id: cardData._id,
      form_data: {},
      user_name: operatorName,
      cancelled: true
    }).catch(() => {});
  },

  goScan() {
    wx.switchTab({ url: '/pages/scan/scan' });
  }
});
