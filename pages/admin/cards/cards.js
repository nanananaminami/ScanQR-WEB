const auth = require('../../../utils/auth');
const { pad, nowStr, formatShortTime } = require('../../../utils/time');

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
      workOrderNo: '',
      stepsText: ''
    },
    processList: [],
    selectedProcesses: [],
    showCustomInput: false,
    customProcessText: '',
    dicts: [],
    headerForm: {},
    // 搜索选择弹层
    showSearchSelect: false,
    searchSelectField: '',
    searchSelectLabel: '',
    searchSelectOptions: [],
    searchSelectValue: '',
    searchKeyword: '',
    filteredOptions: [],
    creating: false,
    // 导出
    showExport: false,
    exportFilter: { status: '', keyword: '', dateFrom: '', dateTo: '' },
    exporting: false
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
    auth.callWithAuth('getCardList', { status: this.data.statusFilter })
      .then((res) => {
        const result = res.result || {};
        if (!result.success) {
          this.setData({ loading: false });
          wx.showToast({ title: result.msg || '加载失败', icon: 'none' });
          return;
        }
        const cards = (result.cards || []).map((c) => ({
          ...c,
          orderNo: c.order_no || c.card_no || '',
          projectLabel: this.getProjectLabel(c),
          workOrderNo: c.work_order_no || '',
          stepCount: (c.dynamic_steps || c.steps || []).length || 0,
          currentStep: c.current_step || this.getCurrentStep(c),
          stepProgress: this.getStepProgress(c),
          lockedText: c.is_locked ? '锁定中' : '空闲',
          lockTimeText: c.lock_time ? formatShortTime(c.lock_time) : '-',
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

  getCurrentStep(card) {
    const steps = card.dynamic_steps || card.steps || [];
    if (steps.length === 0) return '-';
    const idx = card.current_step_index;
    if (idx !== undefined && steps[idx]) return steps[idx].step_name;
    for (let i = 0; i < steps.length; i++) {
      if (!steps[i].prod_completed_at) return steps[i].step_name;
    }
    return steps[steps.length - 1].step_name;
  },

  getStepProgress(card) {
    const steps = card.dynamic_steps || card.steps || [];
    if (steps.length === 0) return '';
    const prodDone = steps.filter(s => s.prod_completed_at || s.step_type === 'qc').length;
    const qcDone = steps.filter(s => s.qc_completed_at).length;
    return prodDone + '/' + qcDone + '/' + steps.length;
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



  onStatusTabChange(e) {
    this.setData({ statusFilter: e.currentTarget.dataset.status });
    this.loadCards();
  },

  // ===== 建卡 =====
  openCreate() {
    wx.showLoading({ title: '加载中...' });
    Promise.all([
      auth.callWithAuth('getTemplateList'),
      auth.callWithAuth('getDictList')
    ]).then(([tplRes, dictRes]) => {
      wx.hideLoading();
      const result = tplRes.result || {};
      if (!result.success || !result.templates || result.templates.length === 0) {
        wx.showModal({ title: '暂无模板', content: '请先在「流程卡模板管理」中创建模板', showCancel: false });
        return;
      }
      const dictResult = dictRes.result || {};
      const dicts = dictResult.dicts || [];
      const processDict = dicts.find(d => d.dict_id === 'process_list');
      const processList = processDict ? (processDict.options || []) : [];
      this.setData({
        templates: result.templates,
        dicts: dicts,
        showCreate: true,
        selectedTemplate: null,
        selectedTemplateName: '',
        createForm: { workOrderNo: '', stepsText: '' },
        processList: processList,
        selectedProcesses: [],
        showCustomInput: false,
        customProcessText: '',
        headerForm: {}
      });
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  closeCreate() {
    this.setData({
      showCreate: false,
      selectedProcesses: [],
      showCustomInput: false,
      customProcessText: ''
    });
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
    // 使用 openCreate 时已缓存的字典同步解析 select 选项，避免异步时序问题
    const dicts = this.data.dicts || [];
    const dictMap = {};
    dicts.forEach(d => { dictMap[d.dict_id] = d.options || []; });
    (tpl.header_fields || []).concat(tpl.detail_fields || []).forEach(f => {
      if (f.type === 'select' && f.dict_id && dictMap[f.dict_id] && (!f.options || f.options.length === 0)) {
        f.options = dictMap[f.dict_id];
      }
    });
    const headerForm = this.buildHeaderForm(tpl.header_fields || [], {});
    this.setData({ selectedTemplate: tpl, selectedTemplateName: tpl.template_name, headerForm });
  },

  onCreateFormChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['createForm.' + field]: e.detail.value || '' });
  },

  toggleProcess(e) {
    const name = e.currentTarget.dataset.name;
    const selected = [...this.data.selectedProcesses];
    const idx = selected.indexOf(name);
    if (idx !== -1) {
      selected.splice(idx, 1);
    } else {
      selected.push(name);
    }
    this.setData({ selectedProcesses: selected });
  },

  removeProcess(e) {
    const name = e.currentTarget.dataset.name;
    const selected = this.data.selectedProcesses.filter(s => s !== name);
    this.setData({ selectedProcesses: selected });
  },

  toggleCustomInput() {
    this.setData({ showCustomInput: !this.data.showCustomInput, customProcessText: '' });
  },

  onCustomProcessInput(e) {
    this.setData({ customProcessText: e.detail.value || '' });
  },

  addCustomProcess() {
    const text = this.data.customProcessText.trim();
    if (!text) {
      wx.showToast({ title: '请输入工序名称', icon: 'none' });
      return;
    }
    const selected = [...this.data.selectedProcesses];
    if (selected.indexOf(text) !== -1) {
      wx.showToast({ title: '该工序已添加', icon: 'none' });
      return;
    }
    selected.push(text);
    this.setData({
      selectedProcesses: selected,
      customProcessText: '',
      showCustomInput: false
    });
  },

  goManageProcesses() {
    wx.navigateTo({ url: '/pages/admin/dicts/dicts' });
  },

  onHeaderFormChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['headerForm.' + field]: e.detail.value || '' });
  },

  pickHeaderSelect(e) {
    // 兼容旧调用：跳转搜索弹层
    this.openSearchSelect(e);
  },

  // 打开搜索选择弹层（支持模糊查询）
  openSearchSelect(e) {
    const field = e.currentTarget.dataset.field;
    const options = this.data.headerForm['__dictOpt_' + field] || [];
    const tpl = this.data.selectedTemplate;
    const f = (tpl && tpl.header_fields || []).find(x => x.field_name === field);
    const label = (f && f.label) || field;
    const currentValue = this.data.headerForm[field] || '';
    this.setData({
      showSearchSelect: true,
      searchSelectField: field,
      searchSelectLabel: label,
      searchSelectOptions: options,
      searchSelectValue: currentValue,
      searchKeyword: '',
      filteredOptions: options
    });
  },

  closeSearchSelect() {
    this.setData({ showSearchSelect: false });
  },

  onSearchSelect(e) {
    const value = e.detail.value;
    const field = this.data.searchSelectField;
    this.setData({
      ['headerForm.' + field]: value,
      showSearchSelect: false
    });
  },

  fillHeaderTime(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['headerForm.' + field]: nowStr() });
    wx.showToast({ title: '已记录时间', icon: 'success', duration: 1000 });
  },

  onHeaderDatePick(e) {
    const field = e.currentTarget.dataset.field;
    const date = e.detail.value;
    const tpl = this.data.selectedTemplate;
    const hf = tpl && (tpl.header_fields || []).find(x => x.field_name === field);
    if (hf && hf.type === 'date') {
      this.setData({ ['headerForm.' + field]: date });
    } else {
      const now = new Date();
      const timeStr = ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
      this.setData({ ['headerForm.' + field]: date + timeStr });
    }
  },

  submitCreate() {
    const { createForm, selectedTemplate, headerForm, creating } = this.data;
    if (creating) return;
    if (!selectedTemplate) {
      wx.showToast({ title: '请选择模板', icon: 'none' });
      return;
    }
    // 工单号为固定字段，流程卡号由云端自动生成（工单号 + 两位顺序码）
    const workOrderNo = (createForm.workOrderNo || '').trim();
    if (!workOrderNo) {
      wx.showToast({ title: '工单号为必填', icon: 'none' });
      return;
    }
    const steps = this.data.selectedProcesses;
    if (steps.length === 0) {
      wx.showToast({ title: '请至少输入一道工序', icon: 'none' });
      return;
    }

    this.setData({ creating: true });
    wx.showLoading({ title: '创建中...' });
    auth.callWithAuth('adminCreateCard', {
      work_order_no: workOrderNo,
      template_id: selectedTemplate.template_id,
      header_data: headerForm,
      steps: steps
    }).then((res) => {
      wx.hideLoading();
      this.setData({ creating: false });
      const result = res.result || {};
      if (result.success) {
        const orderNo = result.order_no;
        this.setData({ showCreate: false, statusFilter: '加工中', selectedProcesses: [], showCustomInput: false, customProcessText: '' });
        this.loadCards();
        // 建卡成功后展示流程卡号并自动跳转生成二维码
        wx.showModal({
          title: '建卡成功',
          content: '流程卡号：' + orderNo + '\n即将生成二维码',
          showCancel: false,
          success: () => {
            wx.navigateTo({ url: '/pages/qr-gen/qr-gen?order_no=' + encodeURIComponent(orderNo) + '&auto=1' });
          }
        });
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

  // 查看二维码
  viewQrCode(e) {
    const orderNo = e.currentTarget.dataset.orderNo;
    wx.navigateTo({ url: '/pages/qr-gen/qr-gen?order_no=' + encodeURIComponent(orderNo) + '&auto=1' });
  },

  // 点击卡片进入详情
  openDetail(e) {
    const orderNo = e.currentTarget.dataset.orderNo;
    wx.navigateTo({ url: '/pages/card-detail/card-detail?order_no=' + encodeURIComponent(orderNo) });
  },

  // 阻止事件冒泡（按钮区域）
  noop() {},

  onPullDownRefresh() {
    this.loadCards();
    wx.stopPullDownRefresh();
  },

  openExport() {
    this.setData({ showExport: true });
  },

  closeExport() {
    this.setData({ showExport: false });
  },

  onExportFilterStatus(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({ 'exportFilter.status': status });
  },

  onExportFilterChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['exportFilter.' + field]: e.detail.value });
  },

  onExportDateFrom(e) {
    this.setData({ 'exportFilter.dateFrom': e.detail.value });
  },

  onExportDateTo(e) {
    this.setData({ 'exportFilter.dateTo': e.detail.value });
  },

  doExport() {
    if (this.data.exporting) return;
    this.setData({ exporting: true });
    wx.showLoading({ title: '导出中...' });

    const { status, keyword, dateFrom, dateTo } = this.data.exportFilter;
    auth.callWithAuth('exportCards', {
      status: status || undefined,
      keyword: keyword || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined
    }).then((res) => {
      wx.hideLoading();
      this.setData({ exporting: false, showExport: false });
      const result = res.result || {};
      if (result.success && result.downloadUrl) {
        const url = result.downloadUrl;
        wx.setClipboardData({ data: url });
        wx.showModal({
          title: '导出成功',
          content: '共导出 ' + result.total + ' 条记录。链接已复制到剪贴板。',
          confirmText: '打开文件',
          cancelText: '关闭',
          success: (modalRes) => {
            if (modalRes.confirm) {
              wx.downloadFile({
                url: url,
                success: (dfRes) => {
                  wx.openDocument({
                    filePath: dfRes.tempFilePath,
                    fileType: 'csv',
                    showMenu: true,
                    fail: () => wx.showToast({ title: '请用 WPS 等应用打开', icon: 'none' })
                  });
                },
                fail: () => wx.showToast({ title: '下载失败', icon: 'none' })
              });
            }
          }
        });
      } else {
        wx.showToast({ title: result.msg || '导出失败', icon: 'none' });
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ exporting: false });
      wx.showToast({ title: '导出失败', icon: 'none' });
    });
  }
});
