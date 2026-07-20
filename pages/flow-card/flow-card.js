const auth = require('../../utils/auth');
const { pad, nowStr } = require('../../utils/time');

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
      prod_started_at: s.prod_started_at || null,
      prod_completed_at: s.prod_completed_at || null,
      prod_completed_by: s.prod_completed_by || null,
      qc_completed_at: s.qc_completed_at || null,
      qc_completed_by: s.qc_completed_by || null,
      depts: depts
    };
  });
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
    match: null,
    matchedStepsData: [],
    currentStepMap: {},
    warehousePersonnel: '',
    warehouseDate: '',
    operatorName: '',
    qualityGateWarning: false,
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
    if (!auth.requireLogin()) return;
    const orderNo = options.order_no ? decodeURIComponent(options.order_no) : '';
    const locked = getApp().globalData.lockedCard;
    this.setData({ orderNo });
    if (locked && locked.cardData) {
      this.initForm(locked);
    } else if (orderNo) {
      this.refetchCard(orderNo);
    } else {
      this.setData({ loading: false });
    }
  },

  initForm(locked) {
    const { cardData, templateData, operator, match } = locked;
    const headerFields = (templateData && templateData.header_fields) || [];
    const headerData = buildHeaderData(headerFields, cardData.header_data || {});
    const detailFields = (templateData && templateData.detail_fields) || [];

    let dynamicSteps = cardData.dynamic_steps;
    if (!dynamicSteps && cardData.steps) {
      dynamicSteps = convertLegacySteps(cardData.steps, detailFields);
    }
    dynamicSteps = cloneSteps(dynamicSteps || []);

    let matchedStepsData = [];
    if (match && match.matched_steps && match.matched_steps.length > 0) {
      matchedStepsData = match.matched_steps.map(ms => {
        const step = dynamicSteps[ms.step_index];
        const prodCompleted = ms.step.prod_completed_at ? true : false;
        const qcCompleted = ms.step.qc_completed_at ? true : false;
        const deptTab = ms.qc_only ? '品质' : '生产';
        return {
          step_index: ms.step_index,
          step_name: ms.step_name,
          step: step,
          sla_text: ms.sla_text || null,
          gated: ms.gated,
          qc_only: ms.qc_only || false,
          deptTab: deptTab,
          isReadonly: (deptTab === '生产' && prodCompleted) || (deptTab === '品质' && qcCompleted),
          prodCompleted: prodCompleted,
          qcCompleted: qcCompleted
        };
      });
    } else if (match && match.matched_step) {
      const ms = match;
      matchedStepsData = [{
        step_index: ms.matched_step_index,
        step_name: ms.matched_step.step_name,
        step: dynamicSteps[ms.matched_step_index],
        sla_text: ms.sla_text || null,
        gated: false,
        deptTab: '生产',
        prodCompleted: ms.matched_step.prod_completed_at ? true : false,
        qcCompleted: ms.matched_step.qc_completed_at ? true : false
      }];
    }

    const hasMatch = matchedStepsData.length > 0;
    const qualityGateWarning = hasMatch ? (match && !match.quality_gate_ok) : false;

    const currentStepMap = {};
    matchedStepsData.forEach(ms => { currentStepMap[ms.step_name] = true; });

    this.setData({
      loading: false,
      cardData,
      templateData: templateData || null,
      orderNo: cardData.order_no || '',
      headerFields,
      headerData,
      detailFields,
      dynamicSteps,
      match: match || null,
      matchedStepsData,
      currentStepMap,
      warehousePersonnel: cardData.warehouse_personnel || '',
      warehouseDate: cardData.warehouse_date || '',
      operatorName: operator || '操作员',
      qualityGateWarning
    });
  },

  refetchCard(orderNo) {
    this.setData({ loading: false });
    wx.showToast({ title: '数据已过期，请重新扫码上锁', icon: 'none', duration: 2000 });
    setTimeout(() => wx.switchTab({ url: '/pages/scan/scan' }), 2000);
  },

  switchDeptTab(e) {
    const idx = e.currentTarget.dataset.idx;
    const tab = e.currentTarget.dataset.tab;
    const data = this.data.matchedStepsData.slice();
    if (data[idx]) {
      data[idx].deptTab = tab;
      data[idx].isReadonly = (tab === '生产' && data[idx].prodCompleted) || (tab === '品质' && data[idx].qcCompleted);
      this.setData({ matchedStepsData: data });
    }
  },

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

  onSearchSelect(e) {
    const value = e.detail.value;
    const { searchSelectField, searchSelectMainIndex, searchSelectSubIndex } = this.data;
    if (searchSelectMainIndex !== -1 && searchSelectSubIndex !== -1) {
      const key = 'dynamicSteps[' + searchSelectMainIndex + '].depts[' + searchSelectSubIndex + '].' + searchSelectField;
      this.setData({ [key]: value, showSearchSelect: false });
    } else {
      this.setData({ ['headerData.' + searchSelectField]: value, showSearchSelect: false });
    }
  },

  fillHeaderTime(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['headerData.' + field]: nowStr() });
    wx.showToast({ title: '已记录时间', icon: 'success', duration: 1000 });
  },

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

  onHeaderDatePick(e) {
    const field = e.currentTarget.dataset.field;
    const date = e.detail.value;
    const hf = this.data.headerFields.find(x => x.field_name === field);
    const isDateOnly = hf && hf.type === 'date';
    if (isDateOnly) {
      this.setData({ ['headerData.' + field]: date });
    } else {
      const now = new Date();
      const timeStr = ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
      this.setData({ ['headerData.' + field]: date + timeStr });
    }
  },

  onDeptDatePick(e) {
    const { mainindex, subindex, field } = e.currentTarget.dataset;
    const date = e.detail.value;
    const df = this.data.detailFields.find(x => x.field_name === field);
    if (df && df.type === 'date') {
      this.setData({ ['dynamicSteps[' + mainindex + '].depts[' + subindex + '].' + field]: date });
    } else {
      const now = new Date();
      const timeStr = ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
      this.setData({ ['dynamicSteps[' + mainindex + '].depts[' + subindex + '].' + field]: date + timeStr });
    }
  },

  onWarehousePersonnelChange(e) {
    this.setData({ warehousePersonnel: e.detail.value });
  },

  onWarehouseDateChange(e) {
    this.setData({ warehouseDate: e.detail.value });
  },

  submitAndUnlock() {
    const { dynamicSteps, cardData, headerData, operatorName, submitting,
            warehousePersonnel, warehouseDate, matchedStepsData, detailFields } = this.data;
    if (submitting) return;

    const matchedSteps = matchedStepsData.map(ms => ({
      step_index: ms.step_index,
      dept_type: ms.deptTab
    }));

    for (const ms of matchedStepsData) {
      const subIndex = ms.deptTab === '生产' ? 0 : 1;
      const step = dynamicSteps[ms.step_index];
      if (!step) continue;
      const dept = (step.depts || [])[subIndex];
      if (!dept) continue;
      for (const df of detailFields) {
        if (!df.required) continue;
        const val = dept[df.field_name];
        if (val === undefined || val === null || val === '' || val === 0) {
          wx.showToast({ title: '请填写「' + ms.step_name + '」的' + df.label, icon: 'none' });
          return;
        }
      }
    }

    const hasGated = matchedStepsData.some(ms => ms.gated && ms.deptTab === '生产');
    if (hasGated) {
      const gatedNames = matchedStepsData
        .filter(ms => ms.gated && ms.deptTab === '生产')
        .map(ms => ms.step_name).join('、');
      wx.showModal({
        title: '工序卡控',
        content: '以下工序的生产填报被卡控：' + gatedNames + '\n请等待上一道工序生产完成后再提交',
        showCancel: false
      });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中...' });

    auth.callWithAuth('submitAndUnlockCard', {
      order_no: cardData.order_no,
      card_id: cardData._id,
      dynamic_steps: dynamicSteps,
      header_data: headerData,
      operator_name: operatorName,
      matched_steps: matchedSteps,
      warehouse_personnel: warehousePersonnel,
      warehouse_date: warehouseDate,
      cancelled: false
    }).then((res) => {
      wx.hideLoading();
      this.setData({ submitting: false });
      const result = res.result || {};
      if (result.success) {
        if (result.quality_gate_blocked && result.quality_gate_violations) {
          wx.showModal({
            title: '入库被阻断',
            content: result.quality_gate_violations.join('\n') + '\n\n已完成提交但入库未生效，品质完成后请重新签字入库',
            showCancel: false
          });
        } else {
          wx.showToast({ title: '提交成功', icon: 'success' });
        }
        this.setData({ submitted: true });
        getApp().globalData.lockedCard = null;
        setTimeout(() => wx.navigateBack(), 1500);
      } else {
        if (result.code === 'GATE_BLOCKED') {
          wx.showModal({ title: '工序卡控', content: result.msg || '请重试', showCancel: false });
        } else {
          wx.showModal({ title: '提交失败', content: result.msg || '请重试', showCancel: false });
        }
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
