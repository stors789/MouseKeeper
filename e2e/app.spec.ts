import { expect, test } from '@playwright/test'

const WORKSPACES = [
  ['/', '群体总览'],
  ['/mice', '小鼠档案'],
  ['/cages', '笼位管理'],
  ['/breeding', '繁育与窝记录'],
  ['/experiments', '实验管理'],
  ['/records', '记录中心'],
  ['/tasks', '任务'],
  ['/data', '数据与安全'],
  ['/settings', '设置']
] as const

test('all workspaces render without runtime errors or horizontal overflow', async ({
  page
}) => {
  const runtimeErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })
  page.on('pageerror', (error) => runtimeErrors.push(error.message))

  for (const [route, heading] of WORKSPACES) {
    await page.goto(route)
    await expect(
      page.getByRole('heading', { level: 2, name: heading })
    ).toBeVisible()
    const viewport = await page.locator('body').evaluate((body) => ({
      clientWidth: body.clientWidth,
      scrollWidth: body.scrollWidth
    }))
    expect(viewport.scrollWidth).toBeLessThanOrEqual(
      viewport.clientWidth + 1
    )
  }

  expect(runtimeErrors).toEqual([])
})

test('creates a cage, an assigned mouse, a weight, and a linked task', async ({
  isMobile,
  page
}) => {
  test.skip(Boolean(isMobile), 'The full mutation workflow is covered once')

  await page.goto('/cages/new')
  await page.getByLabel('笼位编号').fill('E2E-CAGE')
  await page.getByLabel('最大容量').fill('5')
  await page.getByRole('button', { name: '保存笼位' }).click()
  await expect(page).toHaveURL(/\/cages\/(?!new$)[^/]+$/)
  await expect(
    page.getByRole('heading', { level: 2, name: 'E2E-CAGE' })
  ).toBeVisible()

  await page.goto('/mice/new')
  await page.getByLabel('耳标号').fill('E2E-MOUSE')
  await page.getByLabel('品系').fill('C57BL/6J')
  await page.getByRole('combobox', { name: '初始笼位' }).click()
  await page.getByRole('option', { name: /E2E-CAGE/ }).click()
  await page.getByRole('button', { name: '保存小鼠' }).click()
  await expect(page).toHaveURL(/\/mice\/(?!new$)[^/]+$/)
  await expect(
    page.getByRole('heading', { level: 2, name: 'E2E-MOUSE' })
  ).toBeVisible()
  await expect(page.getByText('E2E-CAGE', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '记录体重' }).click()
  const weightDialog = page.getByRole('dialog', { name: '记录体重' })
  await expect(weightDialog).toBeVisible()
  await page.getByRole('spinbutton', { name: '体重' }).fill('24.6')
  await page.getByRole('button', { name: '保存体重' }).click()
  await expect(weightDialog).toBeHidden()
  await expect(page.getByText('24.6 g').first()).toBeVisible()

  await page.goto('/tasks/new')
  await page
    .getByRole('textbox', { name: '标题', exact: true })
    .fill('E2E health check')
  await page.getByRole('textbox', { name: '截止日期' }).fill('2030-01-01')
  await page.getByRole('combobox', { name: '小鼠' }).click()
  await page.getByRole('option', { name: 'E2E-MOUSE' }).click()
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page).toHaveURL('/tasks')
  await expect(page.getByText('E2E health check')).toBeVisible()
})

test('sample data can be generated and downloaded in a complete backup', async ({
  isMobile,
  page
}) => {
  test.skip(Boolean(isMobile), 'Download behavior is covered once')

  await page.goto('/data')
  await page.getByRole('tab', { name: '示例数据' }).click()
  await page.getByRole('button', { name: '生成一组示例数据' }).click()
  await expect(page.getByText(/示例批次 [a-f0-9]{8}/)).toBeVisible()

  await page.getByRole('tab', { name: '备份与恢复' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载完整备份' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(
    /^mousekeeper-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/
  )
})

test('installed app opens an unvisited workspace while offline', async ({
  context,
  isMobile,
  page
}) => {
  test.skip(Boolean(isMobile), 'Offline precache is covered once')

  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (navigator.serviceWorker.controller) return
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => resolve(),
        { once: true }
      )
    })
  })

  await context.setOffline(true)
  try {
    await page.goto('/settings')
    await expect(
      page.getByRole('heading', { level: 2, name: '设置' })
    ).toBeVisible()
  } finally {
    await context.setOffline(false)
  }
})
