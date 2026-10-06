import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/turbines'
  },
  {
    path: '/turbines',
    name: 'turbine-list',
    component: () => import('@/pages/TurbineList.vue'),
    meta: { title: '机组合账', icon: 'Odometer' }
  },
  {
    path: '/blades/:id/segments',
    name: 'blade-segments',
    component: () => import('@/pages/BladeSegment.vue'),
    meta: { title: '叶片分段与剖面', icon: 'Grid' }
  },
  {
    path: '/defects',
    name: 'defect-board',
    component: () => import('@/pages/DefectBoard.vue'),
    meta: { title: '缺陷标注台', icon: 'WarningFilled' }
  },
  {
    path: '/workorders',
    name: 'work-order-list',
    component: () => import('@/pages/WorkOrderList.vue'),
    meta: { title: '维修工单', icon: 'Tools' }
  },
  {
    path: '/report',
    name: 'report-view',
    component: () => import('@/pages/ReportView.vue'),
    meta: { title: '报告与导出', icon: 'Document' }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/turbines'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : '风电叶片巡检缺陷标注台'
  document.title = `${title} · 风电叶片巡检缺陷标注台`
})

export default router
