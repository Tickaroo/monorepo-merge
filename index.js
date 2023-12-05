import { groupLabeledPullRequests } from './src/merge'
import { getInput, setFailed, info, debug } from '@actions/core';
import { getOctokit, context } from '@actions/github';

/**
 * init
 * @description Fetches all PRs from repo with target label and merge each one to a temp branch.
 */
async function init() {
    const token = getInput('repo-token');
    const octokit = getOctokit(token);
    await groupLabeledPullRequests(octokit);
};

init();
