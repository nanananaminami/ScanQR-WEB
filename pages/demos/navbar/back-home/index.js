Component({
  methods: {
    onBack() {
      wx.navigateBack();
    },
    onGoHome() {
      wx.reLaunch({
        url: '/pages/demos/home/home',
      });
    },
  },
});
