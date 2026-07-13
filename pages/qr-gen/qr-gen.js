const { createMatrix } = require('../../utils/qrcode.js');

const QR_SIZE = 480; // canvas 物理像素基准
const MODULE_PADDING = 2; // 留白模块数

Page({
  data: {
    form: {
      cardNo: '',
      prodName: '',
      batchNo: '',
      stepName: ''
    },
    canvasSize: QR_SIZE,
    qrReady: false,
    generating: false,
    saving: false
  },

  onLoad(options) {
    // 支持从外部带参进入预填
    if (options.card_no) {
      this.setData({ 'form.cardNo': decodeURIComponent(options.card_no) });
    }
  },

  onInputChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  buildPayload() {
    const { cardNo, prodName, batchNo, stepName } = this.data.form;
    // 扫码端只解析卡号，所以编码核心为 cardNo；附带信息可扩展
    // 这里采用「卡号」纯文本，保证 scan 页 wx.scanCode 解析一致
    return (cardNo || '').trim();
  },

  handleGenerate() {
    const payload = this.buildPayload();
    if (!payload) {
      this.showMessage('请填写流程卡号', 'warning');
      return;
    }

    this.setData({ generating: true });

    try {
      const modules = createMatrix(payload, 'M');
      this.drawCanvas(modules);
      this.setData({ qrReady: true, generating: false });
      this.showMessage('二维码已生成', 'success');
    } catch (err) {
      this.setData({ generating: false });
      this.showMessage('生成失败：' + (err.message || '内容过长'), 'error');
    }
  },

  drawCanvas(modules) {
    const query = wx.createSelectorQuery();
    query.select('#qrCanvas').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) {
        this.showMessage('Canvas 初始化失败', 'error');
        return;
      }
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio || 2;

      const moduleCount = modules.length;
      const totalModules = moduleCount + MODULE_PADDING * 2;
      const pixelSize = QR_SIZE / totalModules;

      // 设置画布物理尺寸
      canvas.width = QR_SIZE * dpr;
      canvas.height = QR_SIZE * dpr;
      ctx.scale(dpr, dpr);

      // 白色背景
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, QR_SIZE, QR_SIZE);

      // 绘制黑色模块
      ctx.fillStyle = '#000000';
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          if (modules[row][col]) {
            const x = (col + MODULE_PADDING) * pixelSize;
            const y = (row + MODULE_PADDING) * pixelSize;
            ctx.fillRect(x, y, pixelSize, pixelSize);
          }
        }
      }

      this._canvasNode = canvas;
    });
  },

  handleSave() {
    if (!this.data.qrReady || !this._canvasNode) {
      this.showMessage('请先生成二维码', 'warning');
      return;
    }

    this.setData({ saving: true });

    wx.canvasToTempFilePath({
      canvas: this._canvasNode,
      success: (res) => {
        this.saveToAlbum(res.tempFilePath);
      },
      fail: () => {
        this.setData({ saving: false });
        this.showMessage('图片导出失败', 'error');
      }
    });
  },

  saveToAlbum(tempFilePath) {
    wx.saveImageToPhotosAlbum({
      filePath: tempFilePath,
      success: () => {
        this.setData({ saving: false });
        this.showMessage('已保存到相册', 'success');
      },
      fail: (err) => {
        this.setData({ saving: false });
        // 用户拒绝授权时引导打开设置
        if (err.errMsg && err.errMsg.indexOf('auth deny') > -1) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存二维码需要相册权限，是否前往设置开启？',
            success: (r) => {
              if (r.confirm) wx.openSetting();
            }
          });
        } else {
          this.showMessage('保存失败', 'error');
        }
      }
    });
  },

  showMessage(content, theme) {
    const message = this.selectComponent('#t-message');
    if (message) {
      message.show({ content, theme: theme || 'info', duration: 2000 });
    } else {
      wx.showToast({ title: content, icon: 'none' });
    }
  }
});
