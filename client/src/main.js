import { createApp } from 'vue'
import App from './App.vue'
import ToastHost from './components/ToastHost.vue'

const app = createApp(App)
// 全局轻提示宿主：独立于 App 渲染，登录前后都能用
app.component('ToastHost', ToastHost)
app.mount('#app')
