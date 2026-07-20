const auth = require('../../../utils/auth');

const FIELD_TYPES = [
  { type: 'input', name: '文本输入', desc: '编号、名称等' },
  { type: 'number', name: '数字输入', desc: '数量、良品率等' },
  { type: 'select', name: '下拉选择', desc: '选项列表' },
  { type: 'textarea', name: '文本域', desc: '备注说明' },
  { type: 'datetime', name: '时间日期', desc: '自动记录或选择时间' },
  { type: 'date', name: '日期', desc: '仅选择日期' }
];

const TYPE_NAME_MAP = {};
FIELD_TYPES.forEach(t => { TYPE_NAME_MAP[t.type] = t.name; });

let _uidSeq = 0;
function genUid() {
  _uidSeq += 1;
  return 'f_' + Date.now() + '_' + _uidSeq;
}

Page({
  data: {
    loading: true,
    saving: false,
    isEdit: false,
    template_id: '',
    template_name: '',
    section: 'header',
    headerFields: [],
    detailFields: [],
    dicts: [],
    fieldTypes: FIELD_TYPES,
    typeNameMap: TYPE_NAME_MAP,
    showSearchSelect: false,
    searchSelectFieldIndex: -1,
    searchSelectLabel: '',
    searchSelectOptions: [],
    searchSelectValue: '',
    searchKeyword: '',
    filteredOptions: []
  },

  onLoad(options) {
    if (!auth.requireLogin()) return;
    if (!auth.hasPerm('template_manage')) {
      wx.showToast({ title: '无权限', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.loadDicts().then(() => {
      if (options.template_id) {
        this.setData({ isEdit: true, template_id: decodeURIComponent(options.template_id) });
        this.loadTemplate(this.data.template_id);
      } else {
        this.setData({ loading: false });
      }
    });
  },

  loadDicts() {
    return auth.callWithAuth('getDictList').then((res) => {
      const result = res.result || {};
      if (result.success) this.setData({ dicts: result.dicts || [] });
    }).catch(() => {
      wx.showToast({ title: '字典加载失败', icon: 'none' });
    });
  },

  loadTemplate(template_id) {
    auth.callWithAuth('getTemplateList').then((res) => {
      const result = res.result || {};
      if (result.success) {
        const tpl = (result.templates || []).find(t => t.template_id === template_id);
        if (tpl) {
          const headerFields = (tpl.header_fields || []).map(f => this.normalizeField(f));
          const detailFields = (tpl.detail_fields || []).map(f => this.normalizeField(f));
          this.setData({
            template_name: tpl.template_name,
            headerFields,
            detailFields,
            loading: false
          });
        } else {
          this.setData({ loading: false });
          wx.showToast({ title: '模板不存在', icon: 'none' });
        }
      } else {
        this.setData({ loading: false });
      }
    }).catch(() => this.setData({ loading: false }));
  },

  normalizeField(f) {
    return {
      _uid: genUid(),
      field_name: f.field_name || '',
      label: f.label || '',
      type: f.type || 'input',
      required: !!f.required,
      auto_now: f.auto_now !== undefined ? f.auto_now : true,
      width: f.width || 150,
      placeholder: f.placeholder || '',
      default: f.default || '',
      options: Array.isArray(f.options) ? f.options.join('\n') : '',
      dict_id: f.dict_id || '',
      use_dict: !!f.dict_id
    };
  },

  onNameChange(e) {
    this.setData({ template_name: e.detail.value || '' });
  },

  switchSection(e) {
    this.setData({ section: e.currentTarget.dataset.section });
  },

  getFieldsKey() {
    return this.data.section === 'header' ? 'headerFields' : 'detailFields';
  },

  addField() {
    wx.showActionSheet({
      itemList: FIELD_TYPES.map(t => t.name + '（' + t.desc + '）'),
      success: (res) => {
        const type = FIELD_TYPES[res.tapIndex].type;
        const newField = this.normalizeField({ type });
        if (type === 'datetime') newField.placeholder = '自动记录提交时间';
    if (type === 'date') newField.placeholder = '选择日期';
        const key = this.getFieldsKey();
        const fields = this.data[key];
        this.setData({ [key]: fields.concat([newField]) });
      }
    });
  },

  changeFieldType(e) {
    const index = e.currentTarget.dataset.index;
    wx.showActionSheet({
      itemList: FIELD_TYPES.map(t => t.name),
      success: (res) => {
        const type = FIELD_TYPES[res.tapIndex].type;
        const key = this.getFieldsKey();
        const field = Object.assign({}, this.data[key][index], { type });
        if (type === 'datetime') field.placeholder = '自动记录提交时间';
        if (type === 'date') field.placeholder = '选择日期';
        this.setData({ [key + '[' + index + ']']: field });
      }
    });
  },

  onFieldChange(e) {
    const index = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    const key = this.getFieldsKey();
    this.setData({ [key + '[' + index + '].' + field]: e.detail.value || '' });
  },

  onFieldRequiredChange(e) {
    const index = e.currentTarget.dataset.index;
    const key = this.getFieldsKey();
    this.setData({ [key + '[' + index + '].required']: e.detail.value });
  },

  onFieldAutoNowChange(e) {
    const index = e.currentTarget.dataset.index;
    const key = this.getFieldsKey();
    this.setData({ [key + '[' + index + '].auto_now']: e.detail.value });
  },

  onUseDictChange(e) {
    const index = e.currentTarget.dataset.index;
    const key = this.getFieldsKey();
    this.setData({ [key + '[' + index + '].use_dict']: e.detail.value });
    if (!e.detail.value) {
      this.setData({ [key + '[' + index + '].dict_id']: '' });
    }
  },

  openDictSearchSelect(e) {
    const index = e.currentTarget.dataset.index;
    const dicts = this.data.dicts;
    if (dicts.length === 0) {
      wx.showToast({ title: '请先在字典管理中创建', icon: 'none' });
      return;
    }
    const currentValue = this.data[this.getFieldsKey()][index].dict_id || '';
    this.setData({
      showSearchSelect: true,
      searchSelectFieldIndex: index,
      searchSelectLabel: '字典',
      searchSelectOptions: dicts,
      searchSelectValue: currentValue,
      searchKeyword: '',
      filteredOptions: dicts
    });
  },

  closeSearchSelect() {
    this.setData({ showSearchSelect: false });
  },

  onSearchKeywordChange(e) {
    const keyword = (e.detail.value || '').toLowerCase().trim();
    const opts = this.data.searchSelectOptions;
    const filtered = keyword
      ? opts.filter(d => d.dict_name.toLowerCase().indexOf(keyword) !== -1 || d.dict_id.toLowerCase().indexOf(keyword) !== -1)
      : opts;
    this.setData({ searchKeyword: keyword, filteredOptions: filtered });
  },

  clearSearchKeyword() {
    this.setData({ searchKeyword: '', filteredOptions: this.data.searchSelectOptions });
  },

  selectSearchOption(e) {
    const dictId = e.currentTarget.dataset.value;
    const index = this.data.searchSelectFieldIndex;
    const key = this.getFieldsKey();
    this.setData({
      [key + '[' + index + '].dict_id']: dictId,
      showSearchSelect: false
    });
  },

  moveUp(e) {
    const index = e.currentTarget.dataset.index;
    if (index === 0) return;
    const key = this.getFieldsKey();
    const fields = this.data[key].slice();
    const tmp = fields[index - 1];
    fields[index - 1] = fields[index];
    fields[index] = tmp;
    this.setData({ [key]: fields });
  },

  moveDown(e) {
    const index = e.currentTarget.dataset.index;
    const key = this.getFieldsKey();
    const fields = this.data[key];
    if (index >= fields.length - 1) return;
    const arr = fields.slice();
    const tmp = arr[index + 1];
    arr[index + 1] = arr[index];
    arr[index] = tmp;
    this.setData({ [key]: arr });
  },

  removeField(e) {
    const index = e.currentTarget.dataset.index;
    wx.showModal({
      title: '删除字段',
      content: '确定删除该字段？',
      success: (res) => {
        if (!res.confirm) return;
        const key = this.getFieldsKey();
        const fields = this.data[key].slice();
        fields.splice(index, 1);
        this.setData({ [key]: fields });
      }
    });
  },

  validateFields(fields) {
    const seenNames = {};
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f.field_name || !f.label) {
        wx.showToast({ title: '第' + (i + 1) + '个字段缺少变量名或标签', icon: 'none' });
        return false;
      }
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.field_name)) {
        wx.showToast({ title: '变量名非法：' + f.field_name, icon: 'none' });
        return false;
      }
      if (seenNames[f.field_name]) {
        wx.showToast({ title: '变量名重复：' + f.field_name, icon: 'none' });
        return false;
      }
      seenNames[f.field_name] = true;
    }
    return true;
  },

  cleanFields(fields, isDetail) {
    return fields.map(f => {
      const clean = {
        field_name: f.field_name,
        label: f.label,
        type: f.type,
        required: !!f.required,
        sort: 0,
        placeholder: f.placeholder || '',
        default: f.default || ''
      };
      if (isDetail) {
        clean.width = f.width || 150;
      }
      if (f.type === 'datetime') {
        clean.auto_now = f.auto_now !== undefined ? f.auto_now : true;
      }
      if (f.type === 'select') {
        if (f.use_dict && f.dict_id) {
          clean.dict_id = f.dict_id;
          clean.options = [];
        } else {
          clean.options = (f.options || '').split('\n').map(s => s.trim()).filter(s => s);
          clean.dict_id = '';
          if (clean.options.length === 0) {
            return null;
          }
        }
      }
      return clean;
    }).filter(f => f !== null);
  },

  saveTemplate() {
    const { template_name, headerFields, detailFields, isEdit, template_id, saving } = this.data;
    if (saving) return;
    if (!template_name) {
      wx.showToast({ title: '请填写模板名', icon: 'none' });
      return;
    }

    if (!this.validateFields(headerFields)) return;
    if (!this.validateFields(detailFields)) return;

    const cleanHeader = this.cleanFields(headerFields, false);
    const cleanDetail = this.cleanFields(detailFields, true);

    const finalId = template_id || ('TPL_' + Date.now());
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    auth.callWithAuth('adminSaveTemplate', {
      template_id: finalId,
      template_name,
      header_fields: cleanHeader,
      detail_fields: cleanDetail,
      is_new: !isEdit
    }).then((res) => {
      wx.hideLoading();
      this.setData({ saving: false });
      const result = res.result || {};
      if (result.success) {
        wx.showToast({ title: '已保存', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      } else {
        wx.showModal({ title: '保存失败', content: result.msg || '请重试', showCancel: false });
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ saving: false });
    });
  }
});
