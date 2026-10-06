<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Document, Grid, Odometer, Tools, WarningFilled } from '@element-plus/icons-vue'
import { useTurbineStore } from '@/stores/turbineStore'
import { useBladeStore } from '@/stores/bladeStore'
import { useDefectStore } from '@/stores/defectStore'
import { useWorkOrderStore } from '@/stores/workOrderStore'
import { DB_NAME, DB_VERSION } from '@/utils/db'

const route = useRoute()
const router = useRouter()
const turbineStore = useTurbineStore()
const bladeStore = useBladeStore()
const defectStore = useDefectStore()
const workOrderStore = useWorkOrderStore()

/** 叶片分段页的跳转目标：上次查看的叶片 → 当前机组的首片叶片 → 全库首片叶片 */
const targetBladeId = computed<string | null>(() => {
  if (bladeStore.currentBladeId && bladeStore.bladeById(bladeStore.currentBladeId)) {
    return bladeStore.currentBladeId
  }
  const current = turbineStore.currentTurbineId
  if (current) {
    const first = turbineStore.bladesOfTurbine(current)[0]
    if (first) return first.id
  }
  return turbineStore.blades[0]?.id ?? null
})

const navItems = computed(() => {
  const bladeId = targetBladeId.value
  return [
    {
      path: '/turbines',
      label: '机组合账',
      icon: Odometer,
      badge: String(turbineStore.turbines.length),
      disabled: false
    },
    {
      path: bladeId ? `/blades/${bladeId}/segments` : '/turbines',
      label: '叶片分段',
      icon: Grid,
      badge: String(turbineStore.segments.length),
      disabled: !bladeId
    },
    {
      path: '/defects',
      label: '缺陷标注台',
      icon: WarningFilled,
      badge: String(defectStore.openCount),
      disabled: false
    },
    {
      path: '/workorders',
      label: '维修工单',
      icon: Tools,
      badge: String(workOrderStore.stats.total),
      disabled: false
    },
    {
      path: '/report',
      label: '报告与导出',
      icon: Document,
      badge: '',
      disabled: false
    }
  ]
})

const activePath = computed(() => {
  if (route.path.startsWith('/blades/')) {
    const bladeId = targetBladeId.value
    return bladeId ? `/blades/${bladeId}/segments` : route.path
  }
  return route.path
})

const currentScope = computed(() => {
  const turbine = turbineStore.currentTurbine
  if (!turbine) return '未选择机组'
  const blade = bladeStore.currentBlade
  if (blade && blade.turbineId === turbine.id) {
    return `${turbine.code} · 叶片 ${blade.serial}`
  }
  return turbine.code
})

function go(path: string): void {
  void router.push(path)
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-header__brand">
        <span class="app-header__mark">叶</span>
        <div>
          <h1 class="app-header__title">风电叶片巡检缺陷标注台</h1>
          <p class="app-header__sub">机组 · 叶片 · 展向分段 · 缺陷标注 · 维修工单</p>
        </div>
      </div>
      <nav class="app-nav">
        <button
          v-for="item in navItems"
          :key="item.label"
          class="app-nav__item"
          :class="{ 'is-active': activePath === item.path, 'is-disabled': item.disabled }"
          type="button"
          :disabled="item.disabled"
          @click="go(item.path)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
          <em v-if="item.badge" class="app-nav__badge">{{ item.badge }}</em>
        </button>
      </nav>
    </header>

    <main class="app-main">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>

    <footer class="app-footer">
      <span>
        数据仅保存在本浏览器（IndexedDB 库 {{ DB_NAME }}，结构版本 v{{ DB_VERSION }}），不上传任何服务器。
      </span>
      <span>当前范围：{{ currentScope }}</span>
    </footer>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  background: linear-gradient(120deg, #0b3d52 0%, #0f5c7a 55%, #1f8fa8 100%);
  color: #eef7fa;
}

.app-header__brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-header__mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.3);
  font-size: 20px;
  font-weight: 700;
}

.app-header__title {
  margin: 0;
  font-size: 18px;
  letter-spacing: 2px;
  color: #eef7fa;
}

.app-header__sub {
  margin: 2px 0 0;
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(238, 247, 250, 0.75);
}

.app-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.app-nav__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: #eef7fa;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.app-nav__item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
}

.app-nav__item.is-active {
  background: #eef7fa;
  color: #0f5c7a;
  font-weight: 600;
}

.app-nav__item.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.app-nav__badge {
  font-style: normal;
  font-size: 11px;
  padding: 0 6px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
}

.app-main {
  flex: 1;
  width: 100%;
  max-width: 1360px;
  margin: 0 auto;
  padding: 20px 24px 32px;
}

.app-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 24px 20px;
  font-size: 12px;
  color: #7b8c95;
}
</style>
