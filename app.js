import auth from './utils/auth';

const CLOUD_BASE = 'https://cloud1-d3gtr9e3m940ddbfb-1453011694.ap-shanghai.app.tcloudbase.com/api';

App({
    onLaunch: function () {
      this.restoreSession();
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

      wx.request({
        url: CLOUD_BASE + '/getUserRole',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { session_token: session.session_token },
        success: (res) => {
          const result = res.data || {};
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
        },
        fail: () => {
          // 网络异常时保留本地缓存，标记就绪，避免阻塞用户操作
          this.globalData.role = session.role;
          this.globalData.user = session.user;
          this.globalData.roleId = session.role_id;
          this.globalData.permissions = session.permissions || [];
          this.globalData.roleError = '网络异常，使用本地缓存';
          finish(session.role);
        }
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
