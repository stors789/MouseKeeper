import { expect, test, type Page } from '@playwright/test'

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

async function createCage(
  page: Page,
  cageNumber: string,
  capacity = 10
): Promise<string> {
  await page.goto('/cages/new')
  await page.getByLabel('笼位编号').fill(cageNumber)
  await page.getByLabel('最大容量').fill(String(capacity))
  await page.getByRole('button', { name: '保存笼位' }).click()
  await expect(page).toHaveURL(/\/cages\/(?!new$)[^/]+$/)
  return page.url()
}

async function createMouse(
  page: Page,
  input: {
    earTag: string
    sex?: '雄性' | '雌性'
    cageNumber?: string
    birthDate?: string
  }
): Promise<string> {
  await page.goto('/mice/new')
  await page.getByLabel('耳标号').fill(input.earTag)
  await page.getByLabel('品系').fill('C57BL/6J')
  if (input.birthDate) {
    await page.getByLabel('出生日期').fill(input.birthDate)
  }
  if (input.sex) {
    await page.getByRole('combobox', { name: '性别' }).click()
    await page.getByRole('option', { name: input.sex, exact: true }).click()
  }
  if (input.cageNumber) {
    await page.getByRole('combobox', { name: '初始笼位' }).click()
    await page
      .getByRole('option', { name: new RegExp(input.cageNumber) })
      .click()
  }
  await page.getByRole('button', { name: '保存小鼠' }).click()
  await expect(page).toHaveURL(/\/mice\/(?!new$)[^/]+$/)
  return page.url()
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const viewport = await page.locator('body').evaluate((body) => ({
    clientWidth: body.clientWidth,
    scrollWidth: body.scrollWidth
  }))
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1)
}

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
    await expectNoHorizontalOverflow(page)
  }

  await page.getByRole('combobox', { name: '主题模式' }).last().click()
  await page.getByRole('option', { name: '深色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expectNoHorizontalOverflow(page)

  expect(runtimeErrors).toEqual([])
})

test('warns before abandoning an unsaved mouse form', async ({
  isMobile,
  page
}) => {
  test.skip(Boolean(isMobile), 'Desktop sidebar provides a stable navigation target')

  await page.goto('/mice/new')
  await page.getByLabel('耳标号').fill('UNSAVED-E2E')

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('当前更改尚未保存')
    await dialog.dismiss()
  })
  await page.getByRole('link', { name: '笼位', exact: true }).click()
  await expect(page).toHaveURL('/mice/new')

  page.once('dialog', async (dialog) => {
    await dialog.accept()
  })
  await page.getByRole('link', { name: '笼位', exact: true }).click()
  await expect(page).toHaveURL('/cages')
})

test('mobile operational subroutes stay usable without page overflow', async ({
  isMobile,
  page
}) => {
  test.skip(!isMobile, 'This check targets the narrow-screen layouts')

  await page.goto('/mice/bulk-create')
  await expect(
    page.getByRole('heading', { level: 2, name: '批量创建小鼠' })
  ).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto('/data')
  await page.getByRole('button', { name: '示例数据' }).click()
  await page.getByRole('button', { name: '生成一组示例数据' }).click()
  await expect(page.getByText(/示例批次 [a-f0-9]{8}/)).toBeVisible()

  await page.goto('/records/weights/quick')
  await expect(
    page.getByRole('heading', { level: 2, name: '快速称重' })
  ).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto('/cages')
  await page.getByRole('link', { name: /^SAMPLE-/ }).first().click()
  await expect(
    page.getByRole('heading', { level: 3, name: '当前小鼠' })
  ).toBeVisible()
  await expect(page.getByRole('list', { name: '当前笼内小鼠' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('creates a cage, an assigned mouse, a weight, and a linked task', async ({
  page
}) => {
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

test('mouse search, filters, edits, atomic batches, recycle, and refresh persist', async ({
  isMobile,
  page
}) => {
  test.skip(Boolean(isMobile), 'Desktop covers the dense batch workspace')

  await createCage(page, 'E2E-CAGE-A')
  await createCage(page, 'E2E-CAGE-B')
  const maleUrl = await createMouse(page, {
    earTag: 'E2E-MALE',
    sex: '雄性',
    cageNumber: 'E2E-CAGE-A',
    birthDate: '2026-01-01'
  })
  await createMouse(page, {
    earTag: 'E2E-FEMALE',
    sex: '雌性',
    cageNumber: 'E2E-CAGE-A',
    birthDate: '2026-01-02'
  })

  await page.goto(maleUrl)
  await page.getByRole('link', { name: '编辑档案' }).click()
  await page.getByLabel('名称').fill('Edited male')
  await page.getByRole('button', { name: '保存档案更改' }).click()
  await expect(page.getByText('Edited male', { exact: true })).toBeVisible()

  await page.goto('/mice')
  const search = page.getByPlaceholder(/搜索耳标/)
  await search.fill('E2E-MALE')
  await expect(page.getByRole('link', { name: 'E2E-MALE' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'E2E-FEMALE' })).toHaveCount(0)
  await search.fill('')
  await page.getByLabel('按性别筛选').selectOption('male')
  await expect(page.getByRole('link', { name: 'E2E-MALE' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'E2E-FEMALE' })).toHaveCount(0)
  await page.getByRole('button', { name: '清除筛选' }).click()

  await page.getByRole('checkbox', { name: '选择 E2E-MALE' }).check()
  await page.getByRole('checkbox', { name: '选择 E2E-FEMALE' }).check()
  await page.getByRole('button', { name: '批量状态' }).click()
  await page.getByLabel('目标状态').selectOption('reserved')
  await page.getByRole('button', { name: '执行批量操作' }).click()
  await expect(page.getByText('批量状态已更新')).toBeVisible()

  await page.getByRole('checkbox', { name: '选择 E2E-MALE' }).check()
  await page.getByRole('checkbox', { name: '选择 E2E-FEMALE' }).check()
  await page.getByRole('button', { name: '批量转笼' }).click()
  await page.getByLabel('目标笼位').selectOption({ label: 'E2E-CAGE-B' })
  await page.getByRole('button', { name: '执行批量操作' }).click()
  await expect(page.getByText('批量转笼完成')).toBeVisible()
  await expect(
    page
      .locator('.desktop-record-table tbody')
      .getByText('E2E-CAGE-B', { exact: true })
      .first()
  ).toBeVisible()

  await page.goto(maleUrl)
  await page.getByRole('button', { name: '移入回收站' }).click()
  await page.getByRole('button', { name: '确认移入回收站' }).click()
  await expect(page).toHaveURL('/mice')
  await page.goto('/data')
  await page.getByRole('button', { name: /回收站 1/ }).click()
  const recycleRow = page.locator('.recycle-list li').filter({
    hasText: 'E2E-MALE'
  })
  await recycleRow.getByRole('button', { name: '恢复' }).click()
  await expect(page.getByText('记录已恢复')).toBeVisible()

  await page.goto('/mice')
  await search.fill('E2E-MALE')
  await expect(page.getByRole('link', { name: 'E2E-MALE' }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('link', { name: 'E2E-MALE' }).first()).toBeVisible()
})

test('creates a breeding pair, litter, and linked offspring atomically', async ({
  isMobile,
  page
}) => {
  test.skip(Boolean(isMobile), 'Breeding editor is covered in desktop Chromium')

  await createMouse(page, {
    earTag: 'E2E-SIRE',
    sex: '雄性',
    birthDate: '2026-01-01'
  })
  await createMouse(page, {
    earTag: 'E2E-DAM',
    sex: '雌性',
    birthDate: '2026-01-02'
  })
  await page.goto('/breeding/new')
  await page.getByRole('combobox', { name: '父本' }).click()
  await page.getByRole('option', { name: /E2E-SIRE/ }).click()
  await page.getByRole('combobox', { name: '母本' }).click()
  await page.getByRole('option', { name: /E2E-DAM/ }).click()
  await page.getByLabel('合笼日期').fill('2026-07-01')
  await page.getByRole('button', { name: '保存繁育组合' }).click()
  await expect(page).toHaveURL(/\/breeding\/(?!new$)[^/]+$/)

  await page.getByRole('button', { name: '新建窝记录' }).click()
  const litterDialog = page.getByRole('dialog', { name: '新建窝记录' })
  await litterDialog.getByLabel('窝号').fill('LITTER-E2E')
  await litterDialog.getByLabel('出生日期').fill('2026-07-25')
  await litterDialog.getByLabel('出生数量').fill('1')
  await litterDialog.getByLabel('存活数量').fill('1')
  await litterDialog.getByRole('button', { name: '添加后代' }).click()
  await litterDialog.getByLabel('后代 1 耳标').fill('E2E-PUP')
  await litterDialog.getByLabel('后代 1 品系').fill('C57BL/6J')
  await litterDialog
    .getByRole('button', { name: '保存窝记录及 1 只后代' })
    .click()
  await expect(litterDialog).toBeHidden()
  await expect(page.getByText('LITTER-E2E', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'E2E-PUP' })).toBeVisible()
})

test('records weight and event, assigns an experiment, and completes a task', async ({
  isMobile,
  page
}) => {
  test.skip(Boolean(isMobile), 'Research workflow is covered in desktop Chromium')

  const mouseUrl = await createMouse(page, {
    earTag: 'E2E-STUDY-MOUSE',
    sex: '雌性',
    birthDate: '2026-01-01'
  })
  await page.getByRole('button', { name: '记录体重' }).click()
  const weightDialog = page.getByRole('dialog', { name: '记录体重' })
  await weightDialog.getByRole('spinbutton', { name: '体重' }).fill('22.8')
  await weightDialog.getByRole('button', { name: '保存体重' }).click()
  await expect(weightDialog).toBeHidden()
  await expect(page.getByRole('heading', { name: '体重趋势' })).toBeVisible()
  await expect(page.getByText('22.8 g').first()).toBeVisible()

  await page.getByRole('button', { name: '记录事件' }).click()
  const eventDialog = page.getByRole('dialog', { name: '记录事件' })
  await eventDialog.getByLabel('标题').fill('E2E observation')
  await eventDialog.getByLabel('描述').fill('Normal behavior')
  await eventDialog.getByRole('button', { name: '保存事件' }).click()
  await expect(eventDialog).toBeHidden()
  await expect(page.getByText('E2E observation', { exact: true })).toBeVisible()

  await page.goto('/experiments/new')
  await page.getByLabel('实验名称').fill('E2E Study')
  await page.getByRole('button', { name: '创建实验与组别' }).click()
  await expect(page).toHaveURL(/\/experiments\/(?!new$)[^/]+$/)
  await page.getByRole('button', { name: '批量加入小鼠' }).click()
  const assignmentDialog = page.getByRole('dialog', {
    name: '批量加入实验组'
  })
  await assignmentDialog
    .getByRole('checkbox', { name: /E2E-STUDY-MOUSE/ })
    .check()
  await assignmentDialog
    .getByRole('button', { name: '加入 1 只小鼠' })
    .click()
  await expect(assignmentDialog).toBeHidden()
  await expect(
    page.getByRole('link', { name: 'E2E-STUDY-MOUSE' }).first()
  ).toBeVisible()

  await page.goto('/tasks/new')
  await page
    .getByRole('textbox', { name: '标题', exact: true })
    .fill('E2E endpoint task')
  await page.getByLabel('截止日期').fill('2030-01-01')
  await page.getByRole('combobox', { name: '小鼠' }).click()
  await page.getByRole('option', { name: 'E2E-STUDY-MOUSE' }).click()
  await page.getByRole('button', { name: '创建任务' }).click()
  const taskRow = page.locator('.task-list li').filter({
    hasText: 'E2E endpoint task'
  })
  await taskRow.getByRole('button', { name: '完成' }).click()
  await expect(page.getByText('任务已完成')).toBeVisible()
  await page.getByRole('button', { name: '已完成' }).click()
  await expect(page.getByText('E2E endpoint task')).toBeVisible()

  await page.goto(mouseUrl)
  await expect(page.getByText('E2E Study', { exact: true })).toBeVisible()
})

test('sample data can be generated and downloaded in a complete backup', async ({
  isMobile,
  page
}) => {
  test.skip(Boolean(isMobile), 'Download behavior is covered once')

  await page.goto('/data')
  await page.getByRole('button', { name: '示例数据' }).click()
  await page.getByRole('button', { name: '生成一组示例数据' }).click()
  await expect(page.getByText(/示例批次 [a-f0-9]{8}/)).toBeVisible()

  await page.getByRole('button', { name: '备份与恢复' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载完整备份' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(
    /^mousekeeper-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/
  )
  const backupPath = await download.path()
  expect(backupPath).not.toBeNull()

  await page.getByRole('button', { name: '示例数据' }).click()
  await page.getByRole('button', { name: '生成一组示例数据' }).click()
  await expect(page.locator('.sample-batch-list li')).toHaveCount(2)
  await page.getByRole('button', { name: '备份与恢复' }).click()
  await page
    .locator('input[type="file"][accept*="json"]')
    .setInputFiles(backupPath)
  await expect(page.getByText('备份验证通过')).toBeVisible()
  await page.locator('.confirmation-field input').fill('替换本地数据')
  await page
    .getByRole('button', { name: '下载安全备份并执行恢复' })
    .click()
  await expect(page.getByText('本地数据已恢复')).toBeVisible()
  await page.getByRole('button', { name: '示例数据' }).click()
  await expect(page.locator('.sample-batch-list li')).toHaveCount(1)
})

test('CSV preview isolates bad rows, imports valid rows, and exports data', async ({
  isMobile,
  page
}) => {
  test.skip(Boolean(isMobile), 'File import and downloads are covered once')

  await page.goto('/data')
  await page.getByRole('button', { name: 'CSV 导入' }).click()
  await page.locator('input[type="file"][accept*="csv"]').setInputFiles({
    name: 'mice-e2e.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'earTag,strain,sex,birthDate',
        'E2E-CSV-GOOD,C57BL/6J,female,2026-01-01',
        'E2E-CSV-BAD,,invalid,not-a-date'
      ].join('\n')
    )
  })
  await expect(page.getByText('1 行有效')).toBeVisible()
  await expect(page.getByText('1 行错误')).toBeVisible()
  await page.getByRole('button', { name: '导入 1 行' }).click()
  await expect(page.getByText(/成功 1/).first()).toBeVisible()

  await page.goto('/mice')
  await page.getByPlaceholder(/搜索耳标/).fill('E2E-CSV')
  await expect(
    page.getByRole('link', { name: 'E2E-CSV-GOOD' }).first()
  ).toBeVisible()
  await expect(page.getByText('E2E-CSV-BAD', { exact: true })).toHaveCount(0)

  await page.goto('/data')
  await page.getByRole('button', { name: 'CSV 导出' }).click()
  for (const label of ['小鼠档案', '笼位', '实验', '体重记录', '事件记录']) {
    const csvDownload = page.waitForEvent('download')
    await page.getByRole('button', { name: new RegExp(label) }).click()
    expect((await csvDownload).suggestedFilename()).toMatch(/\.csv$/)
  }
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
