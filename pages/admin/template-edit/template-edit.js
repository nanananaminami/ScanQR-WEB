const auth = require('../../../utils/auth');

// 低代码组件库：5 种基础字段类型
const FIELD_TYPES = [
  { type: 'input', name: '文本输入', desc: '单号、批号等' },
  { type: 'number', name: '数字输入', desc: '数量、良品率等' },
  { type: 'select', name: '下拉选择', desc: '制程类型、不良原因' },
  { type: 'textarea', name: '文本域', desc: '备注说明' },
  { type: 'datetime', name: '时间戳', desc: '自动记录当前时间' }
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
    step_name: '',
    fields: [],
    dicts: [],
    fieldTypes: FIELD_TYPES,
    typeNameMap: TYPE_NAME_MAP
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
    }).catch(() => {});
  },

  loadTemplate(template_id) {
    auth.callWithAuth('getTemplateList').then((res) => {
      const result = res.result || {};
      if (result.success) {
        const tpl = (result.templates || []).find(t => t.template_id === template_id);
        if (tpl) {
          const fields = (tpl.fields || []).map(f => this.normalizeField(f));
          this.setData({
            template_name: tpl.template_name,
            step_name: tpl.step_name,
            fields,
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

  // 将服务端字段配置规范化为编辑器内部结构
  normalizeField(f) {
    return {
      _uid: genUid(),
      field_name: f.field_name || '',
      label: f.label || '',
      type: f.type || 'input',
      required: !!f.required,
      unit: f.unit || '',
      placeholder: f.placeholder || '',
      default: f.default || '',
      // select 选项：编辑时用换行符分隔的字符串，方便在 textarea 中编辑
      options: Array.isArray(f.options) ? f.options.join('\n') : '',
      dict_id: f.dict_id || '',
      use_dict: !!f.dict_id
    };
  },

  onNameChange(e) {
    this.setData({ template_name: e.detail.value || '' });
  },

  onStepChange(e) {
    this.setData({ step_name: e.detail.value || '' });
  },

  addField() {
    wx.showActionSheet({
      itemList: FIELD_TYPES.map(t => t.name + '（' + t.desc + '）'),
      success: (res) => {
        const type = FIELD_TYPES[res.tapIndex].type;
        const newField = this.normalizeField({ type });
        if (type === 'datetime') newField.placeholder = '自动记录提交时间';
        this.setData({ fields: this.data.fields.concat([newField]) });
      }
    });
  },

  changeFieldType(e) {
    const index = e.currentTarget.dataset.index;
    wx.showActionSheet({
      itemList: FIELD_TYPES.map(t => t.name),
      success: (res) => {
        const type = FIELD_TYPES[res.tapIndex].type;
        const field = Object.assign({}, this.data.fields[index], { type });
        if (type === 'datetime') field.placeholder = '自动记录提交时间';
        this.setData({ ['fields[' + index + ']']: field });
      }
    });
  },

  onFieldChange(e) {
    const index = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    this.setData({ ['fields[' + index + '].' + field]: e.detail.value || '' });
  },

  onFieldRequiredChange(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ ['fields[' + index + '].required']: e.detail.value });
  },

  onUseDictChange(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ ['fields[' + index + '].use_dict']: e.detail.value });
    if (!e.detail.value) {
      this.setData({ ['fields[' + index + '].dict_id']: '' });
    }
  },

  pickDict(e) {
    const index = e.currentTarget.dataset.index;
    const dicts = this.data.dicts;
    if (dicts.length === 0) {
      wx.showToast({ title: '请先在字典管理中创建', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: dicts.map(d => d.dict_name + '（' + d.dict_id + '）'),
      success: (res) => {
        const dict = dicts[res.tapIndex];
        this.setData({ ['fields[' + index + '].dict_id']: dict.dict_id });
      }
    });
  },

  moveUp(e) {
    const index = e.currentTarget.dataset.index;
    if (index === 0) return;
    const fields = this.data.fields.slice();
    const tmp = fields[index - 1];
    fields[index - 1] = fields[index];
    fields[index] = tmp;
    this.setData({ fields });
  },

  moveDown(e) {
    const index = e.currentTarget.dataset.index;
    if (index >= this.data.fields.length - 1) return;
    const fields = this.data.fields.slice();
    const tmp = fields[index + 1];
    fields[index + 1] = fields[index];
    fields[index] = tmp;
    this.setData({ fields });
  },

  removeField(e) {
    const index = e.currentTarget.dataset.index;
    wx.showModal({
      title: '删除字段',
      content: '确定删除该字段？',
      success: (res) => {
        if (!res.confirm) return;
        const fields = this.data.fields.slice();
        fields.splice(index, 1);
        this.setData({ fields });
      }
    });
  },

  saveTemplate() {
    const { template_name, step_name, fields, isEdit, template_id, saving } = this.data;
    if (saving) return;
    if (!template_name || !step_name) {
      wx.showToast({ title: '请填写模板名和工段', icon: 'none' });
      return;
    }

    // 校验并清洗字段
    const cleanFields = [];
    const seenNames = {};
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f.field_name || !f.label) {
        wx.showToast({ title: '第' + (i + 1) + '个字段缺少变量名或标签', icon: 'none' });
        return;
      }
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.field_name)) {
        wx.showToast({ title: '变量名非法：' + f.field_name, icon: 'none' });
        return;
      }
      if (seenNames[f.field_name]) {
        wx.showToast({ title: '变量名重复：' + f.field_name, icon: 'none' });
        return;
      }
      seenNames[f.field_name] = true;

      const clean = {
        field_name: f.field_name,
        label: f.label,
        type: f.type,
        required: !!f.required,
        unit: f.unit || '',
        placeholder: f.placeholder || '',
        default: f.default || ''
      };
      if (f.type === 'select') {
        if (f.use_dict && f.dict_id) {
          clean.dict_id = f.dict_id;
          clean.options = [];
        } else {
          clean.options = (f.options || '').split('\n').map(s => s.trim()).filter(s => s);
          clean.dict_id = '';
          if (clean.options.length === 0) {
            wx.showToast({ title: f.label + ' 需配置选项或字典', icon: 'none' });
            return;
          }
        }
      }
      if (f.type === 'datetime') clean.auto_now = true;
      cleanFields.push(clean);
    }

    const finalId = template_id || ('TPL_' + Date.now());
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    auth.callWithAuth('adminSaveTemplate', {
      template_id: finalId,
      template_name,
      step_name,
      fields: cleanFields,
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
