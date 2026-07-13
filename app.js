import gulpError from './utils/gulpError';
App({
    onShow() {
        if (gulpError !== 'gulpErrorPlaceHolder') {
            wx.redirectTo({
                url: `/pages/gulp-error/index?gulpError=${gulpError}`,
            });
        }
    },
    onLaunch: function () {
      if (!wx.cloud) {
        console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      } else {
        wx.cloud.init({
          env: 'cloud1-d3gtr9e3m940ddbfb', // 替换为你的真实 EnvID
          traceUser: true,  // 记录用户访问记录（用于后续身份追溯）
        });
      }
    },
    globalData: {
      lockedCard: null
    }
});
