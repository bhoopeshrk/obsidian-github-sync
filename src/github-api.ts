import { requestUrl, RequestUrlParam } from 'obsidian';

interface GitHubRef {
	object: {
		sha: string;
	};
}

interface GitHubBlob {
	content: string;
}

interface GitHubTree {
	sha: string;
	truncated: boolean;
	tree: { type: string; path: string; sha: string; size?: number }[];
}

interface GitHubCommit {
	sha: string;
}

export class GitHubApiClient {
	constructor(private token: string, private username: string, private apiUrl: string) {}

	private async request(endpoint: string, options: Partial<RequestUrlParam> = {}): Promise<unknown> {
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

		if (response.status === 403) {
			const reset = response.headers['x-ratelimit-reset'];
			if (reset) {
				const resetMs = Number(reset) * 1000;
				const waitMin = Math.max(0, Math.ceil((resetMs - Date.now()) / 60000));
				throw new Error(`GitHub API rate limited. Resuming in ~${waitMin} minute${waitMin === 1 ? '' : 's'}.`);
			}
		}
		if (response.status >= 400) throw new Error(`GitHub API error [${response.status}]: ${response.text}`);
		return response.json as unknown;
	}

	async ensureRepoExists(repo: string): Promise<void> {
		try {
			await this.request(`/repos/${this.username}/${repo}`);
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			if (message.includes('404')) {
				await this.request('/user/repos', {
					method: 'POST',
					body: JSON.stringify({ name: repo, private: true, auto_init: true }),
				});
				await new Promise(res => window.setTimeout(res, 3000));
			} else throw e;
		}
	}

	async getLatestCommitSha(repo: string, branch = 'main'): Promise<string> {
		const ref = await this.request(`/repos/${this.username}/${repo}/git/ref/heads/${branch}`) as GitHubRef;
		return ref.object.sha;
	}

	async getTree(repo: string, treeSha: string): Promise<GitHubTree> {
		return (await this.request(`/repos/${this.username}/${repo}/git/trees/${treeSha}?recursive=1`)) as GitHubTree;
	}

	async downloadBlob(repo: string, fileSha: string): Promise<ArrayBuffer> {
		const blob = await this.request(`/repos/${this.username}/${repo}/git/blobs/${fileSha}`) as GitHubBlob;
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
		}) as GitHubBlob & { sha: string };
		return data.sha;
	}

	async commit(repo: string, message: string, tree: { path: string; mode: string; type: string; sha: string | null }[], baseTreeSha: string, parentCommitSha: string) {
		const newTree = await this.request(`/repos/${this.username}/${repo}/git/trees`, {
			method: 'POST',
			body: JSON.stringify({ base_tree: baseTreeSha, tree }),
		}) as GitHubTree;
		const commit = await this.request(`/repos/${this.username}/${repo}/git/commits`, {
			method: 'POST',
			body: JSON.stringify({ message, tree: newTree.sha, parents: [parentCommitSha] }),
		}) as GitHubCommit;
		await this.request(`/repos/${this.username}/${repo}/git/refs/heads/main`, {
			method: 'PATCH',
			body: JSON.stringify({ sha: commit.sha, force: false }),
		});
	}
}
