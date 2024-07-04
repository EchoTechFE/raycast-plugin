import fetch, { Response, Headers } from 'node-fetch'
import { getPreferenceValues } from '@raycast/api'
import { receiveLargeCachedObject } from './utils/cache'

export class User {
  public id = 0
  public name = ''
  public username = ''
  public state = ''
  public avatar_url = ''
  public web_url = ''
}

export class Project {
  public id = 0
  public name_with_namespace = ''
  public name = ''
  public fullPath = ''
  public web_url = ''
  public star_count = 0
  public fork_count = 0
  public last_activity_at = ''
  public readme_url = ''
  public avatar_url = ''
  public owner?: User
  public ssh_url_to_repo?: string = undefined
  public http_url_to_repo?: string = undefined
  public default_branch = ''
  public archived = false
  public remove_source_branch_after_merge = false
}

export class Tag {
  public name = ''
  public message = ''
  public commit = ''
  public release = ''
  public commit_path = ''
  public release_path = ''
}

/* eslint-disable @typescript-eslint/no-explicit-any,@typescript-eslint/explicit-module-boundary-types */
const activateAPILogging = false
export function logAPI(message?: any, ...optionalParams: any[]) {
  if (activateAPILogging) {
    console.log(message, ...optionalParams)
  }
}

function paramString(params: { [key: string]: string }): string {
  const p: string[] = []
  for (const k in params) {
    const v = encodeURI(params[k])
    p.push(`${k}=${v}`)
  }
  let prefix = ''
  if (p.length > 0) {
    prefix = '?'
  }
  return prefix + p.join('&')
}

async function toJsonOrError(response: Response): Promise<any> {
  const s = response.status
  logAPI(`status code: ${s}`)
  if (s >= 200 && s < 300) {
    const json = await response.json()
    return json
  } else if (s == 401) {
    throw Error('Unauthorized')
  } else if (s == 403) {
    const json = (await response.json()) as any
    let msg = 'Forbidden'
    if (json.error && json.error == 'insufficient_scope') {
      msg = 'Insufficient API token scope'
    }
    logAPI(msg)
    throw Error(msg)
  } else if (s == 404) {
    throw Error('Not found')
  } else if (s >= 400 && s < 500) {
    const json = (await response.json()) as any
    logAPI(json)
    const msg = json.message
    throw Error(msg)
  } else {
    logAPI('unknown error')
    throw Error(`http status ${s}`)
  }
}

function getNextPageNumber(page_response: Response): number | undefined {
  const header = page_response.headers.get('x-next-page')
  return header ? parseInt(header) : undefined
}

function maybeUserFromJson(data: any): User | undefined {
  return data ? userFromJson(data) : undefined
}

function userFromJson(data: any): User {
  return {
    id: data.id,
    name: data.name,
    username: data.username,
    web_url: data.web_url,
    avatar_url: data.avatar_url,
    state: data.state,
  }
}

export function dataToProject(project: any): Project {
  return {
    id: project.id,
    name: project.name,
    name_with_namespace: project.name_with_namespace,
    fullPath: project.path_with_namespace,
    web_url: project.web_url,
    star_count: project.star_count,
    fork_count: project.forks_count,
    last_activity_at: project.last_activity_at,
    readme_url: project.readme_url,
    avatar_url: project.avatar_url,
    owner: maybeUserFromJson(project.owner),
    ssh_url_to_repo: project.ssh_url_to_repo,
    http_url_to_repo: project.http_url_to_repo,
    default_branch: project.default_branch,
    archived: project.archived,
    remove_source_branch_after_merge: project.remove_source_branch_after_merge,
  }
}

export class GitLab {
  public token: string
  private url: string
  constructor(url: string, token: string) {
    this.token = token
    this.url = url
  }

  public joinUrl(relativeUrl: string): string {
    return new URL(relativeUrl, this.url).href
  }

  public async fetch(
    url: string,
    params: { [key: string]: string } = {},
    all = false
  ): Promise<any> {
    const per_page = all ? 100 : 50
    const fetchPage = async (page: number): Promise<Response> => {
      const pagedParams = {
        ...params,
        ...{ per_page: `${per_page}`, page: `${page}` },
      }
      const ps = paramString(pagedParams)
      const fullUrl = this.url + '/api/v4/' + url + ps
      logAPI(`send GET request: ${fullUrl}`)
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'PRIVATE-TOKEN': this.token,
        },
      })
      return response
    }
    try {
      const response = await fetchPage(1)
      let json = await toJsonOrError(response)
      if (!all) {
        return json
      }

      let next_page = getNextPageNumber(response)
      while (next_page) {
        logAPI(next_page)
        const page_response = await fetchPage(next_page)
        const page_content = await toJsonOrError(page_response)
        json = json.concat(page_content)
        next_page = getNextPageNumber(page_response)
      }
      return json
    } catch (error: any) {
      throw Error(error) // rethrow error, otherwise raycast could not catch the error
    }
  }
  public async post(
    url: string,
    params: { [key: string]: any } = {},
    noApi: boolean = false
  ): Promise<any> {
    const fullUrl = noApi ? this.url + url : this.url + '/api/v4/' + url
    logAPI(`send POST request: ${fullUrl}`)
    logAPI(params)
    try {
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'PRIVATE-TOKEN': this.token,
        },
        body: JSON.stringify(params),
        redirect: 'follow',
      })
      const s = response.status
      logAPI(`status code: ${s}`)
      if (s >= 200 && s < 300) {
        const json = await response.json()
        return json
      } else if (s === 304) {
        // Not Modified
        // ignored
      } else if (s == 401) {
        throw Error('Unauthorized')
      } else if (s == 403) {
        const json = (await response.json()) as any
        let msg = 'Forbidden'
        if (json.error && json.error == 'insufficient_scope') {
          msg = 'Insufficient API token scope'
        }
        logAPI(msg)
        throw Error(msg)
      } else if (s == 404) {
        throw Error('Not found')
      } else if (s >= 400 && s < 500) {
        const json = (await response.json()) as any
        logAPI(json)
        let msg = `http status ${s}`
        if (json.message) {
          // TODO better form error handling
          msg = JSON.stringify(json.message)
        }
        throw Error(msg)
      } else {
        logAPI('unknown error')
        throw Error(`http status ${s}`)
      }
    } catch (e: any) {
      logAPI(`catch error: ${e}`)
      throw Error(e.message) // rethrow error, otherwise raycast could not catch the error
    }
  }

  public async put(
    url: string,
    params: { [key: string]: any } = {}
  ): Promise<void> {
    const fullUrl = this.url + '/api/v4/' + url
    logAPI(`send PUT request: ${fullUrl}`)
    logAPI(params)
    try {
      const response = await fetch(fullUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'PRIVATE-TOKEN': this.token,
        },
        body: JSON.stringify(params),
      })
      await toJsonOrError(response)
    } catch (e: any) {
      logAPI(`catch error: ${e}`)
      throw Error(e.message) // rethrow error, otherwise raycast could not catch the error
    }
  }

  async getProject(projectID: number): Promise<Project> {
    const pro: Project = await this.fetch(`projects/${projectID}`).then(
      (project) => {
        return dataToProject(project)
      }
    )
    return pro
  }

  async getProjects(
    args = { searchText: '', searchIn: '' }
  ): Promise<Project[]> {
    const params: { [key: string]: any } = {
      starred: true,
    }
    if (args.searchText) {
      params.search = args.searchText
      params.in = args.searchIn || 'title'
    }
    const issueItems: Project[] = await this.fetch('projects', params).then(
      (projects) => {
        return projects.map((project: any) => dataToProject(project))
      }
    )
    return issueItems
  }

  async getProjectTags(projectId: string): Promise<string[]> {
    const tags: Tag[] = await this.fetch(
      `projects/${projectId}/repository/tags`
    )
    return tags.map((tag: any) => tag.name)
  }

  async getMyself(): Promise<User> {
    const user: User = await receiveLargeCachedObject('user', async () => {
      const user: User = await this.fetch('user').then((userData) => {
        return {
          id: userData.id,
          name: userData.name,
          username: userData.username,
          web_url: userData.web_url,
          avatar_url: userData.avatar_url,
          state: userData.state,
        }
      })
      return user
    })
    return user
  }

  async getEvents(actions: string = 'merged'): Promise<any> {
    const user = await this.getMyself()
    const params = {
      actions,
      target_type: 'merge_request',
    }
    const events = await this.fetch(`users/${user.id}/events`, params)
    return events
  }

  async triggerPipeline(fullPath: string, tag: string): Promise<string | void> {
    const params = {
      ref: 'refs/tags/' + tag,
      variables: [
        {
          variable_type: 'env_var',
          key: 'ENV',
          secret_value: 'prod',
        },
        {
          variable_type: 'env_var',
          key: 'VERSION',
          secret_value: 'default',
        },
        {
          variable_type: 'env_var',
          key: 'REGION',
          secret_value: 'cn-shanghai',
        },
      ],
    }
    const preferences = getPreferenceValues()
    const headers = new Headers()
    headers.append('Content-Type', 'application/json')
    headers.append('Cookie', preferences.cookie as string)
    headers.append('x-csrf-token', preferences.csrfToken as string)
    headers.append('Accept', '*/*')
    headers.append('Referer', `${this.url}${fullPath}/-/pipelines`)

    const response = await fetch(`${this.url}/${fullPath}/-/pipelines`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
      redirect: 'manual',
    })
    const s = response.status
    if (s >= 200 && s < 300) {
      return
    } else if (response.status >= 300 && response.status < 400) {
      const redirectedUrl = response.headers.get('Location') ?? ''
      return redirectedUrl
    } else {
      throw Error('error')
    }
  }

  async createNewTag(projectId: string, tag_name: string): Promise<any> {
    const resp = await this.post(`projects/${projectId}/repository/tags`, {
      tag_name,
      ref: 'master',
    })
    return resp
  }

  async getProjectCommits(projectId: string, refName: string): Promise<any> {
    const commits = await this.fetch(
      `projects/${projectId}/repository/commits`,
      { ref_name: refName }
    )
    return commits
  }
}

export function createGitLabClient(): GitLab {
  const preferences = getPreferenceValues()
  const instance = (preferences.instance as string) || 'https://gitlab.com'
  const token = preferences.token as string
  const gitlab = new GitLab(instance, token)
  return gitlab
}

export const gitlab = createGitLabClient()
