# ScanQR-WEB — 微信小程序扫码管理系统

微信小程序项目，基于 TDesign 组件库 + 微信云开发 (CloudBase) 构建的二维码扫码与制卡管理系统。

## 技术栈

- **前端**: 微信小程序原生框架 (JavaScript)，TDesign Miniprogram 组件库
- **后端**: 微信云开发 CloudBase，云函数 (Node.js + wx-server-sdk)
- **渲染**: 支持 Skyline 渲染引擎
- **主题**: 支持深色模式 (light/dark)
- **国际化**: `i18n/base.json`

## 项目结构

```
ScanQR-WEB/
├── app.js              # 入口：云开发初始化、会话恢复
├── app.json            # 路由、tabBar、全局组件、分包配置
├── app.wxss            # 全局样式
├── theme.json          # 深色/浅色主题变量
├── pages/              # 页面目录
│   ├── login/          # 登录页
│   ├── scan/           # 扫码页 (tabBar)
│   ├── process-form/   # 工序表单
│   ├── qr-gen/         # 二维码生成
│   ├── admin/          # 管理后台
│   │   ├── dashboard/  # 数据看板 (tabBar)
│   │   ├── cards/      # 在制卡片管理 (tabBar)
│   │   ├── logs/       # 操作日志 (tabBar)
│   │   ├── profile/    # 个人中心 (tabBar)
│   │   ├── trace/      # 卡片追溯
│   │   ├── users/      # 用户管理
│   │   └── roles/      # 角色管理
│   └── [component-pages]/  # TDesign 组件示例页
├── cloudfunctions/     # 云函数 (17个)
├── components/         # 全局组件 (demo-block, demo-header)
├── behaviors/          # 共享行为 (skyline.js)
├── utils/              # 工具函数
│   ├── auth.js         # 鉴权：会话管理、权限判断、callWithAuth
│   ├── qrcode.js       # 二维码生成
│   └── gulpError.js    # 构建错误处理
├── custom-tab-bar/     # 自定义 TabBar 组件
├── i18n/               # 国际化
└── miniprogram_npm/    # npm 构建产物 (tdesign-miniprogram)
```

## 代码规范

### 页面结构
每个页面包含 4 个文件:
- `页面名.js` — 逻辑层，使用 `Page({...})` 构造器
- `页面名.json` — 配置，引用组件 + 导航栏设置
- `页面名.wxml` — 模板，类 HTML 标记
- `页面名.wxss` — 样式

### 模块引用
- **根目录文件** (app.js) 使用 `import` 语法
- **页面和工具文件** 使用 `require` (CommonJS) 语法
- **云函数** 使用 `require` (Node.js 环境)

### 鉴权规范
- 所有管理员页面入口必须调用 `auth.requireLogin()`
- 权限判断使用 `auth.hasPerm(perm)` 检查具体权限点
- 云函数调用使用 `auth.callWithAuth(name, data)` 自动注入 session_token
- 过期处理已封装在 `callWithAuth` 中，无需额外处理

### 全局数据
```js
getApp().globalData = {
  lockedCard,    // 当前锁定的卡片
  role,          // 角色名
  roleId,        // 角色ID
  user,          // 用户信息
  permissions,   // 权限列表 (如 dashboard_view, cards_view 等)
  roleReady,     // 角色是否就绪
  roleError,     // 角色加载错误
  roleCallbacks  // 角色就绪回调队列
}
```

## 云函数

云函数位于 `cloudfunctions/` 目录，每个函数是一个独立的 npm 包:
- 依赖 `wx-server-sdk ~2.6.3`
- 入口为 `index.js`
- 通过微信开发者工具上传部署

主要云函数:
`login`, `logout`, `getUserRole`, `getDashboardStats`, `getAndLockCard`, `submitAndUnlockCard`, `getCardTrace`, `getLogList`, `getUserList`, `getRoleList`, `adminCreateUser`, `adminUpdateUser`, `adminUpdateUserRole`, `adminResetPassword`, `adminForceUnlock`, `adminSaveRole`, `initSeedData`

## 开发命令

本项目通过**微信开发者工具**运行和调试，没有独立的构建/测试/lint 命令:
- **运行**: 用微信开发者工具打开项目根目录
- **云函数调试**: 在开发者工具中右键云函数 → 上传并部署/云端调试
- **npm 构建**: 工具 → 构建 npm (更新 miniprogram_npm)
- **预览/真机调试**: 工具栏 → 预览 或 真机调试

## 注意事项

- **禁止**修改 `miniprogram_npm/` 目录下的文件 (npm 构建产物)
- **禁止**直接修改 `app.json` 中的权限相关路由而不修改对应的权限配置
- 云函数云环境 ID: `cloud1-d3gtr9e3m940ddbfb`
- 支持分包加载，TDesign 示例页按组件分包
- 自定义 TabBar 在 `custom-tab-bar/` 中实现
- 深色模式变量定义在 `theme.json`，通过 `@navTxtStyle` 等 CSS 变量引用
