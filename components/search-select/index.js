Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    options: {
      type: Array,
      value: []
    },
    label: {
      type: String,
      value: ''
    },
    currentValue: {
      type: String,
      value: ''
    }
  },

  observers: {
    'visible, options'(visible, options) {
      if (visible) {
        this.setData({
          keyword: '',
          filteredOptions: options || []
        });
      }
    }
  },

  data: {
    keyword: '',
    filteredOptions: []
  },

  methods: {
    onSearchChange(e) {
      const keyword = (e.detail.value || '').toLowerCase().trim();
      const opts = this.properties.options || [];
      const filtered = keyword
        ? opts.filter(o => String(o).toLowerCase().indexOf(keyword) !== -1)
        : opts;
      this.setData({ keyword, filteredOptions: filtered });
    },

    clearSearch() {
      const opts = this.properties.options || [];
      this.setData({ keyword: '', filteredOptions: opts });
    },

    onSelect(e) {
      const value = e.currentTarget.dataset.value;
      this.triggerEvent('select', { value });
    },

    onClose() {
      this.triggerEvent('close');
    }
  }
});
