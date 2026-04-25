import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useModalEscape } from '@/hooks/useModalEscape'
import { RestartPolicyField } from '@/components/RestartPolicyField'
import { useAppDialog } from '@/dialog/AppDialogContext'
import { formatThrownEngineError } from '@/lib/alertMessage'
import {
  DOCKERFILE_PRESETS,
  filterDockerfilePresets,
  getDockerfilePresetTitle,
  type DockerfilePreset,
} from '@/lib/dockerfilePresets'
import {
  DOCKER_RUN_TOOLS,
  defaultVersionIdForTool,
  filterDockerRunTools,
  findDockerRunTool,
  getDockerRunToolTitle,
  orderVersionsForUi,
  resolveDockerRunCode,
  sortToolsAsciiAsc,
  type DockerRunTool,
} from '@/lib/dockerRunPresets'
import type { RestartPolicyName } from '@shared/restartPolicy'

const SORTED_RUN_TOOLS_INIT = sortToolsAsciiAsc(DOCKER_RUN_TOOLS)

type Props = {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

type CreateTabId = 'wizard' | 'dockerRun' | 'dockerfile' | 'dockerCompose'

type ListLayout = { top: number; left: number; width: number; maxHeight: number }

export function CreateContainerModal({ open, onClose, onCreated }: Props) {
  const { t, i18n } = useTranslation()
  const { alert } = useAppDialog()
  const [tab, setTab] = useState<CreateTabId>('wizard')
  const [dockerRunText, setDockerRunText] = useState('')
  const [runToolId, setRunToolId] = useState('')
  const [runVersionId, setRunVersionId] = useState('latest')
  const [runToolQuery, setRunToolQuery] = useState('')
  const [runToolOpen, setRunToolOpen] = useState(false)
  const [runToolHighlight, setRunToolHighlight] = useState(0)
  const runToolComboRef = useRef<HTMLDivElement>(null)
  const runToolInputRef = useRef<HTMLInputElement>(null)
  const [runToolListLayout, setRunToolListLayout] = useState<ListLayout | null>(null)
  const runToolListPortalRef = useRef<HTMLUListElement>(null)

  const [dockerfileText, setDockerfileText] = useState('')
  const [composeYamlText, setComposeYamlText] = useState('')
  const [composeProjectName, setComposeProjectName] = useState('')
  const [dockerfileImageTag, setDockerfileImageTag] = useState('docker-browser/local:dev')
  const [dfPresetQuery, setDfPresetQuery] = useState('')
  const [dfPresetOpen, setDfPresetOpen] = useState(false)
  const [dfPresetHighlight, setDfPresetHighlight] = useState(0)
  const dfComboRef = useRef<HTMLDivElement>(null)
  const dfInputRef = useRef<HTMLInputElement>(null)
  const dfListPortalRef = useRef<HTMLUListElement>(null)
  const [dfPresetListLayout, setDfPresetListLayout] = useState<ListLayout | null>(null)

  const bodyScrollRef = useRef<HTMLDivElement>(null)
  const [image, setImage] = useState('nginx:alpine')
  const [name, setName] = useState('')
  const [envText, setEnvText] = useState('')
  const [publishText, setPublishText] = useState('')
  const [cmdText, setCmdText] = useState('')
  const [autoRemove, setAutoRemove] = useState(false)
  const [restartPolicy, setRestartPolicy] = useState<RestartPolicyName>('no')
  const [submitting, setSubmitting] = useState(false)
  const [cliProgressLog, setCliProgressLog] = useState('')
  const cliProgressPreRef = useRef<HTMLPreElement>(null)

  const appendCliProgress = useCallback((chunk: string) => {
    setCliProgressLog((prev) => (prev + chunk).slice(-20000))
  }, [])

  useModalEscape(open, onClose)

  useEffect(() => {
    if (open) {
      setTab('wizard')
      const sorted = sortToolsAsciiAsc(DOCKER_RUN_TOOLS)
      setRunToolId('')
      setRunVersionId(sorted[0] ? defaultVersionIdForTool(sorted[0].versions) : 'latest')
      setRunToolQuery('')
      setRunToolOpen(false)
      setRunToolHighlight(0)
      setDockerRunText('')
      setDockerfileText('')
      setComposeYamlText('')
      setComposeProjectName('')
      setDockerfileImageTag('docker-browser/local:dev')
      setDfPresetQuery('')
      setDfPresetOpen(false)
      setDfPresetHighlight(0)
      setCliProgressLog('')
    }
  }, [open])

  const lang = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const selectedRunTool = useMemo(() => findDockerRunTool(DOCKER_RUN_TOOLS, runToolId), [runToolId])
  const orderedRunVersions = useMemo(
    () => (selectedRunTool ? orderVersionsForUi(selectedRunTool.versions) : []),
    [selectedRunTool],
  )

  const filteredDfPresets = useMemo(
    () => filterDockerfilePresets(dfPresetQuery, lang),
    [dfPresetQuery, lang],
  )

  const filteredRunTools = useMemo(
    () => filterDockerRunTools(SORTED_RUN_TOOLS_INIT, runToolQuery, lang),
    [runToolQuery, lang],
  )

  const composeProjectTrim = composeProjectName.trim()
  const composeProjectInvalid =
    composeProjectTrim.length > 0 && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(composeProjectTrim)

  useEffect(() => {
    setDfPresetHighlight((h) => (filteredDfPresets.length === 0 ? 0 : Math.min(h, filteredDfPresets.length - 1)))
  }, [filteredDfPresets.length])

  useEffect(() => {
    setRunToolHighlight((h) => (filteredRunTools.length === 0 ? 0 : Math.min(h, filteredRunTools.length - 1)))
  }, [filteredRunTools.length])

  useEffect(() => {
    if (tab !== 'dockerfile') setDfPresetOpen(false)
    if (tab !== 'dockerRun') setRunToolOpen(false)
  }, [tab])

  useEffect(() => {
    if (!dfPresetOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      const node = e.target as Node
      if (dfComboRef.current?.contains(node)) return
      if (dfListPortalRef.current?.contains(node)) return
      setDfPresetOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [dfPresetOpen])

  useEffect(() => {
    if (!runToolOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      const node = e.target as Node
      if (runToolComboRef.current?.contains(node)) return
      if (runToolListPortalRef.current?.contains(node)) return
      setRunToolOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [runToolOpen])

  const syncDfPresetListPosition = useCallback(() => {
    if (!dfPresetOpen || !dfInputRef.current) {
      setDfPresetListLayout(null)
      return
    }
    const r = dfInputRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom - 8
    const maxH = Math.max(80, Math.min(208, spaceBelow))
    setDfPresetListLayout({
      top: r.bottom + 2,
      left: r.left,
      width: Math.max(160, r.width),
      maxHeight: maxH,
    })
  }, [dfPresetOpen])

  const syncRunToolListPosition = useCallback(() => {
    if (!runToolOpen || !runToolInputRef.current) {
      setRunToolListLayout(null)
      return
    }
    const r = runToolInputRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom - 8
    const maxH = Math.max(80, Math.min(208, spaceBelow))
    setRunToolListLayout({
      top: r.bottom + 2,
      left: r.left,
      width: Math.max(160, r.width),
      maxHeight: maxH,
    })
  }, [runToolOpen])

  useLayoutEffect(() => {
    syncDfPresetListPosition()
  }, [syncDfPresetListPosition, dfPresetOpen, dfPresetQuery, dfPresetHighlight, filteredDfPresets.length])

  useLayoutEffect(() => {
    syncRunToolListPosition()
  }, [syncRunToolListPosition, runToolOpen, runToolQuery, runToolHighlight, filteredRunTools.length])

  useEffect(() => {
    if (!dfPresetOpen) return
    const onScrollOrResize = () => syncDfPresetListPosition()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    const scrollEl = bodyScrollRef.current
    scrollEl?.addEventListener('scroll', onScrollOrResize, true)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      scrollEl?.removeEventListener('scroll', onScrollOrResize, true)
    }
  }, [dfPresetOpen, syncDfPresetListPosition])

  useEffect(() => {
    if (!runToolOpen) return
    const onScrollOrResize = () => syncRunToolListPosition()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    const scrollEl = bodyScrollRef.current
    scrollEl?.addEventListener('scroll', onScrollOrResize, true)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      scrollEl?.removeEventListener('scroll', onScrollOrResize, true)
    }
  }, [runToolOpen, syncRunToolListPosition])

  useEffect(() => {
    if (!submitting) return
    const el = cliProgressPreRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [cliProgressLog, submitting])

  useEffect(() => {
    const tool = findDockerRunTool(DOCKER_RUN_TOOLS, runToolId)
    if (!tool) return
    setRunVersionId((prev) =>
      tool.versions.some((v) => v.versionId === prev) ? prev : defaultVersionIdForTool(tool.versions),
    )
  }, [runToolId])

  useEffect(() => {
    if (!runToolId) return
    const code = resolveDockerRunCode(DOCKER_RUN_TOOLS, runToolId, runVersionId)
    if (code) setDockerRunText(code)
  }, [runToolId, runVersionId])

  if (!open) return null

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await window.dockerDesktop.createRunContainer({
        image: image.trim(),
        name: name.trim() || undefined,
        envText,
        publishText,
        cmdText: cmdText.trim() || undefined,
        autoRemove,
        restartPolicy,
      })
      if (!res.ok) throw new Error(res.error)
      onCreated()
      onClose()
    } catch (e) {
      const text = formatThrownEngineError(t, e)
      if (text) await alert(text)
    } finally {
      setSubmitting(false)
    }
  }

  const submitCreateRestart = async () => {
    setSubmitting(true)
    setCliProgressLog(
      tab === 'dockerRun'
        ? `${t('create.cliProgressDockerRun')}\n\n`
        : tab === 'dockerfile'
          ? `${t('create.cliProgressDockerfile')}\n\n`
          : `${t('create.cliProgressDockerCompose')}\n\n`,
    )
    try {
      if (tab === 'dockerRun') {
        const res = await window.dockerDesktop.createAndRestartFromDockerRunCli(
          dockerRunText.trim(),
          appendCliProgress,
        )
        if (!res.ok) throw new Error(res.error)
      } else if (tab === 'dockerfile') {
        const res = await window.dockerDesktop.buildAndRunFromDockerfile({
          dockerfile: dockerfileText,
          imageTag: dockerfileImageTag.trim(),
          onProgress: appendCliProgress,
        })
        if (!res.ok) throw new Error(res.error)
      } else if (tab === 'dockerCompose') {
        const res = await window.dockerDesktop.composeUpFromYaml({
          composeYaml: composeYamlText,
          projectName: composeProjectTrim || undefined,
          onProgress: appendCliProgress,
        })
        if (!res.ok) throw new Error(res.error)
      } else {
        return
      }
      onCreated()
      onClose()
    } catch (e) {
      const text = formatThrownEngineError(t, e)
      if (text) await alert(text)
    } finally {
      setSubmitting(false)
    }
  }

  const tabBtn = (id: CreateTabId, label: string) => {
    const active = tab === id
    return (
      <button
        key={id}
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => setTab(id)}
        className={`shrink-0 rounded-t-md border-b-2 px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
          active
            ? 'border-sky-600 text-sky-800 dark:border-sky-400 dark:text-sky-200'
            : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
        }`}
      >
        {label}
      </button>
    )
  }

  const applyDockerfilePreset = (p: DockerfilePreset) => {
    setDockerfileText(p.code)
    setDfPresetQuery('')
    setDfPresetOpen(false)
    setDfPresetHighlight(0)
  }

  const applyDockerRunTool = (tool: DockerRunTool) => {
    setRunToolId(tool.id)
    setRunToolQuery(getDockerRunToolTitle(tool, lang))
    setRunToolOpen(false)
    setRunToolHighlight(0)
    setRunVersionId(defaultVersionIdForTool(tool.versions))
  }

  const cliSubmitDisabled =
    tab === 'dockerRun'
      ? !dockerRunText.trim()
      : tab === 'dockerfile'
        ? !dockerfileText.trim() || !dockerfileImageTag.trim()
        : tab === 'dockerCompose'
          ? !composeYamlText.trim() || composeProjectInvalid
          : true

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-zinc-200 px-4 pb-0 pt-4 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t('create.title')}</h2>
          <div className="mt-2 flex flex-wrap gap-0.5" role="tablist" aria-label={t('create.title')}>
            {tabBtn('wizard', t('create.tabWizard'))}
            {tabBtn('dockerRun', t('create.tabDockerRun'))}
            {tabBtn('dockerfile', t('create.tabDockerfile'))}
            {tabBtn('dockerCompose', t('create.tabDockerCompose'))}
          </div>
        </div>

        <div ref={bodyScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'wizard' ? (
            <>
              <p className="mb-3 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">{t('create.hint')}</p>
              <div className="flex flex-col gap-2.5">
                <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                  {t('create.image')} *
                  <input
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
                  />
                </label>
                <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                  {t('create.name')}
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('create.namePlaceholder')}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
                  />
                </label>
                <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                  {t('create.publish')}
                  <input
                    value={publishText}
                    onChange={(e) => setPublishText(e.target.value)}
                    placeholder={t('create.publishPlaceholder')}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
                  />
                </label>
                <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                  {t('create.env')}
                  <textarea
                    value={envText}
                    onChange={(e) => setEnvText(e.target.value)}
                    rows={3}
                    placeholder={t('create.envPlaceholder')}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
                  />
                </label>
                <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                  {t('create.cmd')}
                  <input
                    value={cmdText}
                    onChange={(e) => setCmdText(e.target.value)}
                    placeholder={t('create.cmdPlaceholder')}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
                  />
                </label>
                <RestartPolicyField
                  value={restartPolicy}
                  disabled={autoRemove}
                  onChange={(v) => setRestartPolicy(v)}
                />
                <label className="flex items-center gap-2 text-[11px] text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={autoRemove}
                    onChange={(e) => {
                      const on = e.target.checked
                      setAutoRemove(on)
                      if (on) setRestartPolicy('no')
                    }}
                  />
                  {t('create.autoRemove')}
                </label>
              </div>
            </>
          ) : null}

          {tab === 'dockerRun' ? (
            <div className="flex flex-col gap-3">
              <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                {t('create.dockerRunLabel')}
                <textarea
                  value={dockerRunText}
                  onChange={(e) => setDockerRunText(e.target.value)}
                  rows={8}
                  spellCheck={false}
                  placeholder={t('create.dockerRunPlaceholder')}
                  className="mt-1 w-full resize-y rounded-md border border-zinc-300 bg-white px-2 py-2 font-mono text-[11px] leading-relaxed text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              </label>
              <p className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t('create.dockerRunFootnote')}</p>
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t('create.dockerRunExamplesTitle')}
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div ref={runToolComboRef} className="relative min-w-0 flex-1 basis-[12rem]">
                    <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                      {t('create.dockerRunSelectTool')}
                      <input
                        ref={runToolInputRef}
                        type="text"
                        role="combobox"
                        aria-expanded={runToolOpen}
                        aria-controls="docker-run-tool-listbox"
                        aria-autocomplete="list"
                        value={runToolQuery}
                        onChange={(e) => {
                          setRunToolQuery(e.target.value)
                          setRunToolOpen(true)
                        }}
                        onFocus={() => setRunToolOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setRunToolOpen(false)
                            return
                          }
                          if (e.key === 'ArrowDown') {
                            e.preventDefault()
                            setRunToolOpen(true)
                            if (filteredRunTools.length === 0) return
                            setRunToolHighlight((h) => (h + 1) % filteredRunTools.length)
                            return
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault()
                            setRunToolOpen(true)
                            if (filteredRunTools.length === 0) return
                            setRunToolHighlight((h) => (h - 1 + filteredRunTools.length) % filteredRunTools.length)
                            return
                          }
                          if (e.key === 'Enter') {
                            const tool = filteredRunTools[runToolHighlight]
                            if (runToolOpen && tool) {
                              e.preventDefault()
                              applyDockerRunTool(tool)
                            }
                          }
                        }}
                        placeholder={t('create.dockerRunToolFilterPlaceholder')}
                        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                      />
                    </label>
                    {runToolOpen && runToolListLayout
                      ? createPortal(
                          <ul
                            ref={runToolListPortalRef}
                            id="docker-run-tool-listbox"
                            role="listbox"
                            aria-label={t('create.dockerRunToolListLabel')}
                            style={{
                              position: 'fixed',
                              top: runToolListLayout.top,
                              left: runToolListLayout.left,
                              width: runToolListLayout.width,
                              maxHeight: runToolListLayout.maxHeight,
                              zIndex: 100,
                            }}
                            className="overflow-auto rounded-md border border-zinc-200 bg-white py-0.5 shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
                          >
                            {filteredRunTools.length === 0 ? (
                              <li className="px-2 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                                {t('create.dockerRunToolEmpty')}
                              </li>
                            ) : (
                              filteredRunTools.map((tool, idx) => {
                                const title = getDockerRunToolTitle(tool, lang)
                                const active = idx === runToolHighlight
                                return (
                                  <li
                                    key={tool.id}
                                    role="option"
                                    aria-selected={active}
                                    className={`cursor-pointer px-2 py-1.5 text-[11px] text-zinc-800 dark:text-zinc-100 ${
                                      active
                                        ? 'bg-sky-500/15 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100'
                                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                    }`}
                                    onMouseEnter={() => setRunToolHighlight(idx)}
                                    onMouseDown={(ev) => ev.preventDefault()}
                                    onClick={() => applyDockerRunTool(tool)}
                                  >
                                    <span className="font-mono text-zinc-500 dark:text-zinc-400">{tool.id}</span>
                                    <span className="mx-1 text-zinc-400">·</span>
                                    {title}
                                  </li>
                                )
                              })
                            )}
                          </ul>,
                          document.body,
                        )
                      : null}
                  </div>
                  <label className="min-w-0 flex-1 basis-[10rem] text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                    {t('create.dockerRunSelectVersion')}
                    <select
                      value={runVersionId}
                      disabled={!runToolId}
                      onChange={(e) => setRunVersionId(e.target.value)}
                      className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                    >
                      {orderedRunVersions.map((v) => (
                        <option key={v.versionId} value={v.versionId}>
                          {v.versionId === 'latest' ? t('create.dockerRunVersionLatest') : v.versionId}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'dockerfile' ? (
            <div className="flex flex-col gap-3">
              <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                {t('create.dockerfileLabel')}
                <textarea
                  value={dockerfileText}
                  onChange={(e) => setDockerfileText(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  placeholder={t('create.dockerfilePlaceholder')}
                  className="mt-1 w-full resize-y rounded-md border border-zinc-300 bg-white px-2 py-2 font-mono text-[11px] leading-relaxed text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              </label>
              <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                {t('create.dockerfileImageTag')}
                <input
                  value={dockerfileImageTag}
                  onChange={(e) => setDockerfileImageTag(e.target.value)}
                  placeholder={t('create.dockerfileImageTagPlaceholder')}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
                />
              </label>
              <p className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t('create.dockerfileFootnote')}</p>
              <div ref={dfComboRef} className="relative">
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t('create.dockerfileExamplesTitle')}
                  <input
                    ref={dfInputRef}
                    type="text"
                    role="combobox"
                    aria-expanded={dfPresetOpen}
                    aria-controls="dockerfile-preset-listbox"
                    aria-autocomplete="list"
                    value={dfPresetQuery}
                    onChange={(e) => {
                      setDfPresetQuery(e.target.value)
                      setDfPresetOpen(true)
                    }}
                    onFocus={() => setDfPresetOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setDfPresetOpen(false)
                        return
                      }
                      if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        setDfPresetOpen(true)
                        if (filteredDfPresets.length === 0) return
                        setDfPresetHighlight((h) => (h + 1) % filteredDfPresets.length)
                        return
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        setDfPresetOpen(true)
                        if (filteredDfPresets.length === 0) return
                        setDfPresetHighlight((h) => (h - 1 + filteredDfPresets.length) % filteredDfPresets.length)
                        return
                      }
                      if (e.key === 'Enter') {
                        const p = filteredDfPresets[dfPresetHighlight]
                        if (dfPresetOpen && p) {
                          e.preventDefault()
                          applyDockerfilePreset(p)
                        }
                      }
                    }}
                    placeholder={t('create.dockerfilePresetPlaceholder')}
                    className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[11px] text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  />
                </label>
                {dfPresetOpen && dfPresetListLayout
                  ? createPortal(
                      <ul
                        ref={dfListPortalRef}
                        id="dockerfile-preset-listbox"
                        role="listbox"
                        aria-label={t('create.dockerfilePresetListLabel')}
                        style={{
                          position: 'fixed',
                          top: dfPresetListLayout.top,
                          left: dfPresetListLayout.left,
                          width: dfPresetListLayout.width,
                          maxHeight: dfPresetListLayout.maxHeight,
                          zIndex: 100,
                        }}
                        className="overflow-auto rounded-md border border-zinc-200 bg-white py-0.5 shadow-lg dark:border-zinc-600 dark:bg-zinc-900"
                      >
                        {filteredDfPresets.length === 0 ? (
                          <li className="px-2 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {t('create.dockerfilePresetEmpty')}
                          </li>
                        ) : (
                          filteredDfPresets.map((p, idx) => {
                            const title = getDockerfilePresetTitle(p, lang)
                            const active = idx === dfPresetHighlight
                            return (
                              <li
                                key={p.id}
                                role="option"
                                aria-selected={active}
                                className={`cursor-pointer px-2 py-1.5 text-[11px] text-zinc-800 dark:text-zinc-100 ${
                                  active
                                    ? 'bg-sky-500/15 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100'
                                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                                }`}
                                onMouseEnter={() => setDfPresetHighlight(idx)}
                                onMouseDown={(ev) => ev.preventDefault()}
                                onClick={() => applyDockerfilePreset(p)}
                              >
                                {title}
                              </li>
                            )
                          })
                        )}
                      </ul>,
                      document.body,
                    )
                  : null}
              </div>
            </div>
          ) : null}

          {tab === 'dockerCompose' ? (
            <div className="flex flex-col gap-3">
              <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                {t('create.dockerComposeLabel')}
                <textarea
                  value={composeYamlText}
                  onChange={(e) => setComposeYamlText(e.target.value)}
                  rows={12}
                  spellCheck={false}
                  placeholder={t('create.dockerComposePlaceholder')}
                  className="mt-1 w-full resize-y rounded-md border border-zinc-300 bg-white px-2 py-2 font-mono text-[11px] leading-relaxed text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              </label>
              <label className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                {t('create.dockerComposeProjectName')}
                <input
                  value={composeProjectName}
                  onChange={(e) => setComposeProjectName(e.target.value)}
                  placeholder={t('create.dockerComposeProjectPlaceholder')}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-950"
                />
              </label>
              {composeProjectInvalid ? (
                <p className="text-[10px] text-amber-700 dark:text-amber-300">{t('create.dockerComposeProjectInvalid')}</p>
              ) : null}
              <p className="text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">{t('create.dockerComposeFootnote')}</p>
            </div>
          ) : null}

          {(tab === 'dockerRun' || tab === 'dockerfile' || tab === 'dockerCompose') && cliProgressLog ? (
            <div className="mt-3 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950">
              <div className="flex items-center justify-between border-b border-zinc-200 px-2 py-1 dark:border-zinc-600">
                <span className="text-[10px] font-medium text-zinc-700 dark:text-zinc-300">
                  {t('create.cliProgressTitle')}
                </span>
                {submitting ? (
                  <span className="text-[10px] text-sky-600 dark:text-sky-400">{t('common.loading')}</span>
                ) : null}
              </div>
              <pre
                ref={cliProgressPreRef}
                className="max-h-40 overflow-auto whitespace-pre-wrap break-all px-2 py-2 font-mono text-[10px] leading-snug text-zinc-800 dark:text-zinc-200"
              >
                {cliProgressLog}
              </pre>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-[11px] dark:border-zinc-600"
          >
            {t('common.cancel')}
          </button>
          {tab === 'wizard' ? (
            <button
              type="button"
              disabled={submitting || !image.trim()}
              onClick={() => void submit()}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
            >
              {submitting ? t('common.loading') : t('create.submit')}
            </button>
          ) : null}
          {tab === 'dockerRun' || tab === 'dockerfile' || tab === 'dockerCompose' ? (
            <button
              type="button"
              disabled={submitting || cliSubmitDisabled}
              onClick={() => void submitCreateRestart()}
              className="rounded-md bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
            >
              {submitting
                ? t('common.loading')
                : tab === 'dockerCompose'
                  ? t('create.submitComposeUp')
                  : t('create.submitCreateRestart')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
