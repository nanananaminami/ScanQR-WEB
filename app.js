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
          traceUser: true,
        });
        this.fetchUserRole();
      }
    },
    fetchUserRole() {
      const finish = () => {
        this.globalData.roleReady = true;
        const callbacks = this.globalData.roleCallbacks || [];
        callbacks.forEach(cb => cb(this.globalData.role));
        this.globalData.roleCallbacks = [];
      };

      wx.cloud.callFunction({ name: 'getUserRole' })
        .then((res) => {
          const result = res.result || {};
          if (result.success) {
            this.globalData.role = result.role;
            this.globalData.user = result.user;
            if (result.is_new_user && result.is_first_admin) {
              wx.showToast({ title: '欢迎使用，您已自动成为系统管理员', icon: 'none', duration: 3000 });
            }
          } else {
            // 云函数返回但身份异常，降级为操作员
            this.globalData.role = 'operator';
            this.globalData.roleError = result.msg || '身份获取失败';
          }
          finish();
        })
        .catch(() => {
          this.globalData.role = 'operator';
          this.globalData.roleError = '云函数 getUserRole 未部署';
          finish();
        });
    },
    globalData: {
      lockedCard: null,
      role: null,
      user: null,
      roleReady: false,
      roleError: null,
      roleCallbacks: []
    }
});
