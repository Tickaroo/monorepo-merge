import { groupLabeledPullRequests } from './src/merge'
import { getInput, setFailed, info, debug } from '@actions/core';
import { getOctokit, context } from '@actions/github';

/**
 * init
 * @description Fetches all PRs from repo with target label and merge each one to a temp branch.
 */
async function init() {
    await groupLabeledPullRequests(octokit);
};

init();
