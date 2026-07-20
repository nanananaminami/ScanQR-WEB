Page({
    data: {
        failImage: 'error-circle-filled',
    },
    toHome() {
        wx.reLaunch({
            url: '/pages/demos/home/home',
        });
    },
});
