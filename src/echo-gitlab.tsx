import React, { useState, useEffect } from 'react'
import { Action, Form, ActionPanel, showToast, open } from '@raycast/api'
import { useQuery } from '@tanstack/react-query'
import { withQuery } from './features/with-query'
import { gitlab } from './gitlab'

function compareVersions(a: string, b: string) {
  const versionA = a.match(/\d+/g)
  const versionB = b.match(/\d+/g)
  if (versionA && versionB) {
    const versionANumbers = versionA.map(Number)
    const versionBNumbers = versionB.map(Number)
    return versionBNumbers.reduce((result, current, index) => {
      // 如果前面的部分已经有不同，则不再比较后面的部分
      if (result !== 0) return result
      // 比较当前部分的数字
      return current - versionANumbers[index]
    }, 0)
  }
  return 0
}

const SearchItemsView: React.FC = () => {
  const [commit, setCommit] = useState('')
  const [projectId, setProjectId] = useState('')
  const [projectName, setProjectName] = useState('')
  const [webURL, setWebURL] = useState('')
  const [version, setVersion] = useState('PATCH')
  const [nextTag, setNextTag] = useState('')
  const [isPublishPipe, setIsPublishPipe] = useState(true)

  // Query to get the latest project from recent events
  const { data: latestProject, isFetching: isFetchingLatestProject } = useQuery(
    {
      queryKey: ['latestProject'],
      queryFn: async () => {
        const events = await gitlab.getEvents()
        const latestProjectId = events?.[0]?.project_id
        if (latestProjectId) {
          const project = await gitlab.getProject(latestProjectId)
          return project
        }
        return null
      },
      staleTime: 1000 * 60 * 60, // 1 hour
    }
  )

  // Set the latest project as the default selected project
  useEffect(() => {
    if (latestProject) {
      setProjectId('' + latestProject.id)
    }
  }, [latestProject])

  // Query latest project commits
  const { data: commits, isFetching: isFetchingCommits } = useQuery({
    queryKey: ['commits', projectId],
    queryFn: async () => {
      const commits = await gitlab.getProjectCommits(projectId, 'master')
      return commits || []
    },
    enabled: !!projectId,
    staleTime: 1000 * 60,
  })

  useEffect(() => {
    if (commits?.length) {
      setCommit(commits[0].title)
    }
  }, [commits])

  // useEffect(() => {
  //   if (commits.length) {
  //     // setCommit(commits[0].title)
  //   }
  // }, [commits])

  // Query to get the project list
  const { data: projects, isFetching: isFetchingProjects } = useQuery({
    queryKey: ['searchItems', projectName],
    queryFn: async () => {
      const query = {
        searchText: projectName || '',
        searchIn: 'title',
      }
      const projects = await gitlab.getProjects(query)
      return projects || []
    },
    staleTime: 1000 * 60, // 1 mins
    enabled: !!projectId,
  })

  // Combine latest project with projects list
  const combinedProjects = latestProject
    ? [
        latestProject,
        ...(projects?.filter((item) => item.id !== latestProject.id) || []),
      ]
    : projects || []

  // Update webURL whenever the projectId or projects change
  useEffect(() => {
    if (projectId) {
      const webURL =
        combinedProjects.find((item) => item.id === parseInt(projectId))
          ?.web_url ??
        combinedProjects?.[0]?.web_url ??
        ''
      setWebURL(webURL)
    }
  }, [combinedProjects, projectId])

  // Query to get the tags of the selected project
  const { data: tags, isFetching: isFetchingTags } = useQuery({
    queryKey: ['tags', projectId],
    queryFn: async () => {
      const tags = await gitlab.getProjectTags(projectId)
      tags.sort(compareVersions)
      return tags || []
    },
    enabled: !!projectId, // Only run the query if projectId is set
    staleTime: 1000 * 60,
  })

  useEffect(() => {
    const currentVersion = tags?.[0] ?? 'v0.0.0'
    const isVersionPrefixed = currentVersion.startsWith('v')

    // 移除前缀 'v'，然后拆分版本号
    const versionParts = currentVersion.replace('v', '').split('.').map(Number)
    const [major, minor, patch] = versionParts

    if (version === 'PATCH') {
      // 更新 PATCH 版本号
      const newPatch = patch + 1
      setNextTag(`${isVersionPrefixed ? 'v' : ''}${major}.${minor}.${newPatch}`)
    } else if (version === 'MINOR') {
      // 更新 MINOR 版本号
      const newMinor = minor + 1
      setNextTag(`${isVersionPrefixed ? 'v' : ''}${major}.${newMinor}.0`)
    } else if (version === 'MAJOR') {
      // 更新 MAJOR 版本号
      const newMajor = major + 1
      setNextTag(`${isVersionPrefixed ? 'v' : ''}${newMajor}.0.0`)
    }
  }, [tags, version])

  const submit = async () => {
    const project = combinedProjects.find(
      (item) => item.id === parseInt(projectId)
    )
    // 创建 TAG 并发布 pipeline
    await gitlab.createNewTag(projectId, nextTag)
    // 等待 2s
    await new Promise((resolve) => setTimeout(resolve, 2000))
    await showToast({ title: '发布成功' })
    if (isPublishPipe) {
      const url = await gitlab.triggerPipeline(project?.fullPath || '', nextTag)
      if (url) {
        open(url)
      }
    }
  }

  const isLoading =
    isFetchingLatestProject ||
    isFetchingProjects ||
    isFetchingTags ||
    isFetchingCommits

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Create Tag And Run Pipeline"
            onSubmit={submit}
          />
          {projectId && <Action.OpenInBrowser url={webURL} />}
        </ActionPanel>
      }
      isLoading={isLoading}
    >
      <Form.Description title="commit" text={commit ?? ''} />
      <Form.Dropdown
        id="Project"
        title="项目名称"
        throttle
        storeValue
        value={projectId}
        onChange={setProjectId}
        onSearchTextChange={setProjectName}
        isLoading={isFetchingProjects}
      >
        {combinedProjects?.map((item) => (
          <Form.Dropdown.Item
            key={item.id}
            value={'' + item.id}
            title={`${item.name}(${item.id})`}
          />
        ))}
      </Form.Dropdown>
      <Form.Description title="当前版本" text={tags?.[0] ?? ''} />
      <Form.Dropdown
        id="version"
        title="发布类型"
        value={version}
        onChange={setVersion}
      >
        <Form.Dropdown.Item value="PATCH" title="修订号(PATCH)" />
        <Form.Dropdown.Item value="MINOR" title="次版本号(MINOR)" />
        <Form.Dropdown.Item value="MAJOR" title="主版本号(MAJOR)" />
      </Form.Dropdown>
      <Form.Description title="发布版本" text={nextTag} />
      <Form.Checkbox
        id="publishPipe"
        label="默认发布 Pipeline"
        value={isPublishPipe}
        onChange={setIsPublishPipe}
      ></Form.Checkbox>
    </Form>
  )
}

export default withQuery(SearchItemsView)
