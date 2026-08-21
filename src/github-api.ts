import { requestUrl, RequestUrlParam } from 'obsidian';

export class GitHubApiClient {
  constructor(private token: string, private username: string, private apiUrl: string) {}

  private async request(endpoint: string, options: Partial<RequestUrlParam> = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${this.apiUrl}${endpoint}`;
    const response = await requestUrl({
      url,
      method: options.method || 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
      body: options.body,
    });

    if (response.status >= 400) throw new Error(`GitHub API Error [${response.status}]: ${response.text}`);
    return response.json;
  }

  async ensureRepoExists(repo: string): Promise<void> {
    try {
      await this.request(`/repos/${this.username}/${repo}`);
    } catch (e: any) {
      if (e.message.includes('404')) {
        await this.request('/user/repos', {
          method: 'POST',
          body: JSON.stringify({ name: repo, private: true, auto_init: true }),
        });
        // Wait for GitHub background worker to initialize the repo
        await new Promise(res => setTimeout(res, 3000));
      } else throw e;
    }
  }

  async getLatestCommitSha(repo: string, branch = 'main'): Promise<string> {
    const ref = await this.request(`/repos/${this.username}/${repo}/git/ref/heads/${branch}`);
    return ref.object.sha;
  }

  async getTree(repo: string, treeSha: string) {
    return this.request(`/repos/${this.username}/${repo}/git/trees/${treeSha}?recursive=1`);
  }

  async downloadBlob(repo: string, fileSha: string): Promise<ArrayBuffer> {
    const blob = await this.request(`/repos/${this.username}/${repo}/git/blobs/${fileSha}`);
    const binaryString = window.atob(blob.content.replace(/\n/g, ''));
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async uploadBlob(repo: string, contentBase64: string): Promise<string> {
    const data = await this.request(`/repos/${this.username}/${repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: contentBase64, encoding: 'base64' }),
    });
    return data.sha;
  }

  async commit(repo: string, message: string, tree: any[], baseTreeSha: string, parentCommitSha: string) {
    const newTree = await this.request(`/repos/${this.username}/${repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree }),
    });
    const commit = await this.request(`/repos/${this.username}/${repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: newTree.sha, parents: [parentCommitSha] }),
    });
    await this.request(`/repos/${this.username}/${repo}/git/refs/heads/main`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  }
}