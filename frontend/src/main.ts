import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from '@/App.vue'
import router from '@/router'
import { ensureSeeded, stampDbVersion } from '@/utils/db'
import '@/styles/main.css'

const app = createApp(App)

Object.entries(ElementPlusIconsVue).forEach(([key, component]) => {
  app.component(key, component)
})

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

stampDbVersion()

// 首次进入自动播种演示数据（幂等：机组表非空时不做任何写入），完成后再挂载，避免首屏空白
ensureSeeded().finally(() => {
  app.mount('#app')
})
