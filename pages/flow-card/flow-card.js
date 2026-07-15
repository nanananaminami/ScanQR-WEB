const auth = require('../../utils/auth');

function cloneSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((s) => {
    const copy = {};
    for (const k in s) {
      if (s.hasOwnProperty(k)) {
        copy[k] = Array.isArray(s[k]) ? s[k].map(d => Object.assign({}, d)) : s[k];
      }
    }
    return copy;
  });
}

function cloneObj(obj) {
  if (!obj) return {};
  const copy = {};
  for (const k in obj) {
    if (obj.hasOwnProperty(k)) copy[k] = obj[k];
  }
  return copy;
}

function buildHeaderData(headerFields, existing) {
  const data = {};
  headerFields.forEach(f => {
    const existingVal = existing[f.field_name];
    if (existingVal !== undefined && existingVal !== null && existingVal !== '') {
      data[f.field_name] = existingVal;
    } else if (f.default) {
      data[f.field_name] = f.default;
    } else {
      data[f.field_name] = f.type === 'number' ? 0 : '';
    }
  });
  return data;
}

// 兼容旧版扁平 steps（prod_/qc_）→ 新版 dynamic_steps（嵌套 depts）
function convertLegacySteps(steps, detailFields) {
  if (!Array.isArray(steps)) return [];
  return steps.map(s => {
    const depts = [
      { dept_name: '生产' },
      { dept_name: '品质' }
    ];
    (detailFields || []).forEach(f => {
      depts[0][f.field_name] = s['prod_' + f.field_name] !== undefined ? s['prod_' + f.field_name] : '';
      depts[1][f.field_name] = s['qc_' + f.field_name] !== undefined ? s['qc_' + f.field_name] : '';
    });
    return {
      step_name: s.step_name || '',
      sort: s.sort || 0,
      device_no: s.device_no || '',
      fixture_no: s.fixture_no || '',
      depts: depts
    };
  });
}

function nowStr() {
  const now = new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
}

Page({
  data: {
    loading: true,
    submitting: false,
    submitted: false,
    cardData: null,
    templateData: null,
    orderNo: '',
    headerFields: [],
    headerData: {},
    detailFields: [],
    dynamicSteps: [],
    warehousePersonnel: '',
    warehouseDate: '',
    operatorName: '',
    datePickerVisible: false,
    datePickerValue: '',
    datePickerTarget: null,
    showSearchSelect: false,
    searchSelectField: '',
    searchSelectLabel: '',
    searchSelectOptions: [],
    searchSelectValue: '',
    searchSelectMainIndex: -1,
    searchSelectSubIndex: -1,
    searchKeyword: '',
    filteredOptions: []
  },

  onLoad(options) {
    const orderNo = options.order_no ? decodeURIComponent(options.order_no) : '';
    const locked = getApp().globalData.lockedCard;

    if (locked && locked.cardData) {
      this.initForm(locked);
    } else if (orderNo) {
      this.refetchCard(orderNo);
    } else {
      this.setData({ loading: false });
    }
  },

  initForm(locked) {
    const { cardData, templateData, operator } = locked;
    const headerFields = (templateData && templateData.header_fields) || [];
    const headerData = buildHeaderData(headerFields, cardData.header_data || {});
    const detailFields = (templateData && templateData.detail_fields) || [];

    let dynamicSteps = cardData.dynamic_steps;
    if (!dynamicSteps && cardData.steps) {
      dynamicSteps = convertLegacySteps(cardData.steps, detailFields);
    }
    dynamicSteps = cloneSteps(dynamicSteps || []);

    this.setData({
      loading: false,
      cardData,
      templateData: templateData || null,
      orderNo: cardData.order_no || '',
      headerFields,
      headerData,
      detailFields,
      dynamicSteps,
      warehousePersonnel: cardData.warehouse_personnel || '',
      warehouseDate: cardData.warehouse_date || '',
      operatorName: operator || '操作员'
    });
  },

  refetchCard(orderNo) {
    wx.cloud.database().collection('process_cards').where({ order_no: orderNo }).get()
      .then((res) => {
        if (res.data.length > 0) {
          const card = res.data[0];
          this.setData({
            loading: false,
            cardData: card,
            orderNo: card.order_no || '',
            dynamicSteps: cloneSteps(card.dynamic_steps || []),
            headerData: cloneObj(card.header_data || {}),
            warehousePersonnel: card.warehouse_personnel || '',
            warehouseDate: card.warehouse_date || ''
          });
          wx.showToast({ title: '数据已过期，请重新扫码上锁', icon: 'none' });
        } else {
          this.setData({ loading: false });
        }
      })
      .catch(() => {
        this.setData({ loading: false });
      });
  },

  // ===== 表头 =====
  onHeaderInputChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['headerData.' + field]: e.detail.value });
  },

  openSearchSelect(e) {
    const { field, mainindex, subindex, options } = e.currentTarget.dataset;
    let currentValue = '';
    let label = field;
    if (mainindex !== undefined && subindex !== undefined) {
      const dept = (this.data.dynamicSteps[mainindex] || {}).depts || [];
      currentValue = (dept[subindex] || {})[field] || '';
    } else {
      const hf = this.data.headerFields.find(x => x.field_name === field);
      label = (hf && hf.label) || field;
      currentValue = this.data.headerData[field] || '';
    }
    const opts = options || [];
    this.setData({
      showSearchSelect: true,
      searchSelectField: field,
      searchSelectLabel: label,
      searchSelectOptions: opts,
      searchSelectValue: currentValue,
      searchSelectMainIndex: mainindex !== undefined ? mainindex : -1,
      searchSelectSubIndex: subindex !== undefined ? subindex : -1,
      searchKeyword: '',
      filteredOptions: opts
    });
  },

  closeSearchSelect() {
    this.setData({ showSearchSelect: false });
  },

  onSearchKeywordChange(e) {
    const keyword = (e.detail.value || '').toLowerCase().trim();
    const opts = this.data.searchSelectOptions;
    const filtered = keyword
      ? opts.filter(o => String(o).toLowerCase().indexOf(keyword) !== -1)
      : opts;
    this.setData({ searchKeyword: keyword, filteredOptions: filtered });
  },

  clearSearchKeyword() {
    this.setData({ searchKeyword: '', filteredOptions: this.data.searchSelectOptions });
  },

  selectSearchOption(e) {
    const value = e.currentTarget.dataset.value;
    const { searchSelectField, searchSelectMainIndex, searchSelectSubIndex } = this.data;
    if (searchSelectMainIndex !== -1 && searchSelectSubIndex !== -1) {
      this.setData({
        ['dynamicSteps[' + searchSelectMainIndex + '].depts[' + searchSelectSubIndex + '].' + searchSelectField]: value,
        showSearchSelect: false
      });
    } else {
      this.setData({
        ['headerData.' + searchSelectField]: value,
        showSearchSelect: false
      });
    }
  },

  fillHeaderTime(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['headerData.' + field]: nowStr() });
    wx.showToast({ title: '已记录时间', icon: 'success', duration: 1000 });
  },

  // ===== 工序级字段（device_no / fixture_no）=====
  onDeviceChange(e) {
    const mainIndex = e.currentTarget.dataset.mainindex;
    this.setData({ ['dynamicSteps[' + mainIndex + '].device_no']: e.detail.value });
  },

  onFixtureChange(e) {
    const mainIndex = e.currentTarget.dataset.mainindex;
    this.setData({ ['dynamicSteps[' + mainIndex + '].fixture_no']: e.detail.value });
  },

  // ===== 部门级字段（depts[subIndex].field）=====
  onDeptFieldChange(e) {
    const { mainindex, subindex, field } = e.currentTarget.dataset;
    this.setData({ ['dynamicSteps[' + mainindex + '].depts[' + subindex + '].' + field]: e.detail.value });
  },

  onDeptNumberChange(e) {
    const { mainindex, subindex, field } = e.currentTarget.dataset;
    this.setData({ ['dynamicSteps[' + mainindex + '].depts[' + subindex + '].' + field]: Number(e.detail.value) || 0 });
  },

  fillDeptTime(e) {
    const { mainindex, subindex, field } = e.currentTarget.dataset;
    this.setData({ ['dynamicSteps[' + mainindex + '].depts[' + subindex + '].' + field]: nowStr() });
    wx.showToast({ title: '已记录时间', icon: 'success', duration: 1000 });
  },

  openDatePicker(e) {
    const { field, mainindex, subindex } = e.currentTarget.dataset;
    let currentValue = '';
    if (mainindex !== undefined && subindex !== undefined) {
      const dept = (this.data.dynamicSteps[mainindex] || {}).depts || [];
      currentValue = (dept[subindex] || {})[field] || '';
    } else {
      currentValue = this.data.headerData[field] || '';
    }
    this.setData({
      datePickerVisible: true,
      datePickerValue: currentValue,
      datePickerTarget: { field, mainIndex: mainindex, subIndex: subindex }
    });
  },

  onDatePickerConfirm(e) {
    const target = this.data.datePickerTarget;
    if (!target) return;
    const value = e.detail.value;
    if (target.mainIndex !== undefined && target.subIndex !== undefined) {
      this.setData({
        ['dynamicSteps[' + target.mainIndex + '].depts[' + target.subIndex + '].' + target.field]: value,
        datePickerVisible: false,
        datePickerTarget: null
      });
    } else {
      this.setData({
        ['headerData.' + target.field]: value,
        datePickerVisible: false,
        datePickerTarget: null
      });
    }
  },

  onDatePickerCancel() {
    this.setData({ datePickerVisible: false, datePickerTarget: null });
  },

  // ===== 入库 =====
  onWarehousePersonnelChange(e) {
    this.setData({ warehousePersonnel: e.detail.value });
  },

  onWarehouseDateChange(e) {
    this.setData({ warehouseDate: e.detail.value });
  },

  // ===== 提交 / 放弃 =====
  submitAndUnlock() {
    const { dynamicSteps, cardData, headerData, operatorName, submitting, warehousePersonnel, warehouseDate } = this.data;
    if (submitting) return;

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...' });

    auth.callWithAuth('submitAndUnlockCard', {
      order_no: cardData.order_no,
      card_id: cardData._id,
      dynamic_steps: dynamicSteps,
      header_data: headerData,
      operator_name: operatorName,
      warehouse_personnel: warehousePersonnel,
      warehouse_date: warehouseDate,
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
      content: '将放弃本次填报并释放流转卡锁，确定继续？',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ submitting: true });
        wx.showLoading({ title: '解锁中...' });
        auth.callWithAuth('submitAndUnlockCard', {
          order_no: cardData.order_no,
          card_id: cardData._id,
          dynamic_steps: [],
          operator_name: operatorName,
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
    auth.callWithAuth('submitAndUnlockCard', {
      order_no: cardData.order_no,
      card_id: cardData._id,
      dynamic_steps: [],
      operator_name: operatorName,
      cancelled: true
    }).catch(() => {});
  },

  goScan() {
    wx.switchTab({ url: '/pages/scan/scan' });
  }
});
