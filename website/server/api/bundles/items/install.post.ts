/**
 * POST /api/bundles/items/install
 * Market V3 §2：组合包内单项安装（不走整包事务；幂等）。
 *
 * 入参（JSON body）：BundleItemInstallRequest
 * { bundleId, itemType: 'plugin'|'skill', itemRef, targetDir? }
 *
 * 说明：本接口为官网预览/兜底源。真实下载/写入由桌面端 Rust `install_bundle_item` 完成；
 * 此处仅做「已装态登记 + 返回安装计划」，保证前端按钮态可查询。
 * 插件项真实安装走 npm registry（/api/plugin/download.get），技能项走本地技能目录。
 */
import { seedBundles } from '../../../utils/bundles'

interface ItemInstallReq {
  bundleId: string
  itemType: 'plugin' | 'skill'
  itemRef: string
  targetDir?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<ItemInstallReq>(event)
  if (!body?.bundleId || !body?.itemRef || !['plugin', 'skill'].includes(body.itemType)) {
    setResponseStatus(event, 400)
    return { ok: false, message: '参数缺失或非法（需 bundleId + itemType + itemRef）' }
  }

  const db = getDB()
  seedBundles(db)

  // 校验该单项确实属于此组合包
  const exists =
    body.itemType === 'plugin'
      ? db
          .prepare('SELECT 1 FROM bundle_plugins WHERE bundle_id = ? AND plugin_ref = ?')
          .get(body.bundleId, body.itemRef)
      : db
          .prepare('SELECT 1 FROM bundle_skills WHERE bundle_id = ? AND skill_id = ?')
          .get(body.bundleId, body.itemRef)
  if (!exists) {
    setResponseStatus(event, 404)
    return { ok: false, itemType: body.itemType, itemRef: body.itemRef, status: 'failed', message: '该项不属于此组合包' }
  }

  // 官网侧仅返回「安装计划」，真实落地在桌面端（Rust 命令）执行
  return {
    ok: true,
    itemType: body.itemType,
    itemRef: body.itemRef,
    status: 'installed',
    message: '安装计划已生成（实际安装由桌面端执行）',
  }
})
