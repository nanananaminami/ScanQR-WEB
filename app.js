import gulpError from './utils/gulpError';
import auth from './utils/auth';

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
          env: 'cloud1-d3gtr9e3m940ddbfb',
          traceUser: true,
        });
        this.restoreSession();
      }
    },
    // 启动时根据本地缓存的会话令牌，向云端校验并恢复登录态
    restoreSession() {
      const session = auth.getSession();
      const finish = (role) => {
        this.globalData.roleReady = true;
        const callbacks = this.globalData.roleCallbacks || [];
        callbacks.forEach(cb => cb(role));
        this.globalData.roleCallbacks = [];
      };

      if (!session || !session.session_token) {
        this.globalData.role = null;
        this.globalData.user = null;
        this.globalData.permissions = [];
        finish(null);
        return;
      }

      wx.cloud.callFunction({
        name: 'getUserRole',
        data: { session_token: session.session_token }
      }).then((res) => {
        const result = res.result || {};
        if (result.success) {
          auth.setSession(Object.assign({}, session, {
            user: result.user,
            role: result.role,
            role_id: result.role_id,
            permissions: result.permissions
          }));
          finish(result.role);
        } else {
          auth.clearSession();
          this.globalData.roleError = result.msg || '身份获取失败';
          finish(null);
        }
      }).catch(() => {
        // 网络异常时保留本地缓存，标记就绪，避免阻塞用户操作
        this.globalData.role = session.role;
        this.globalData.user = session.user;
        this.globalData.roleId = session.role_id;
        this.globalData.permissions = session.permissions || [];
        this.globalData.roleError = '网络异常，使用本地缓存';
        finish(session.role);
      });
    },
    globalData: {
      lockedCard: null,
      role: null,
      roleId: null,
      user: null,
      permissions: [],
      roleReady: false,
      roleError: null,
      roleCallbacks: []
    }
});
