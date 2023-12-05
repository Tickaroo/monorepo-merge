import { context, getOctokit } from '@actions/github';
import { getInput, setFailed, setOutput } from '@actions/core';
import { createComment, cleanup } from './lib';

/**
 * groupLabeledPullRequests
 * @description Fetches all PRs from repo with target label and merge each one to a temp branch.
 * @arg {object} octokit Github Octokit Rest client
 */
export const groupLabeledPullRequests = async function (octokit) {
    //create tempBranchName
    const tempBranch = `temp-ci-${context.repo.repo}-${Date.now()}`;
    try {
        //get input from Github Job declaration
        var pulls = [];
        const label = getInput('target-label');
        //Create search query
        const q = `is:pr label:${label} repo:${context.repo.owner}/${context.repo.repo} state:open`;
        console.log("QUERY " + q)
        //Call github API through the octokit client
        const { data } = await octokit.search.issuesAndPullRequests({
            q,
            sort: 'created',
            order: 'desc',
        });
        //iterate over selected PRs
        if(data.total_count > 0) {
            for (const item of data.items) {
                const accPull = await octokit.request(`GET /repos/{owner}/{repo}/pulls/{pull_number}`, {
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    pull_number: item.number
                });
                console.log(`Pushing External PR #${item.number} to array`);
                pulls.push(accPull.data);
            }
            await mergeBranches(octokit, pulls, tempBranch);
        
            //cleanup function (delete temp branch)
            await cleanup(octokit, tempBranch);
            setOutput('temp-branch', tempBranch);

        } else {
            console.log("No open pull requests found")
        }
        

    } catch (e) {
        console.error(e)
        if (e.message === "Merge conflict") {
            console.log("Merge conflict error.")
            //Add label
        }
        await cleanup(octokit, tempBranch);
        setFailed(e.message);
    }
};

/**
 * mergeBranches
 * @description Merge the the head branches in a PR array into a temp branch.
 * @arg {array} pulls Array of pullr request objects.
 * @arg {object} octokit Github Octokit Rest client.
 * @arg {string} tempBranch Temporal branch to merge the grouped heads.
 */
const mergeBranches = async function (octokit, pulls, tempBranch) {
    //get client with permissions to merge
    // const token = getInput('private-token');
    // const octokitMerge = getOctokit(token);
    //get latest main branch sha.
    const mainBranchName = getInput('main-branch');
    const integrationBranchName = getInput('integration-branch');
    const { data: { commit: { sha } } } = await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
        owner: context.repo.owner,
        repo: context.repo.repo,
        branch: mainBranchName
    });
    console.log(`Creating branch ${tempBranch} from main with sha: ${sha}.`);
    //create temp branch from main branch.
    await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
        owner: context.repo.owner,
        repo: context.repo.repo,
        ref: `refs/heads/${tempBranch}`,
        sha: sha,
    });
    //merge group branches to tmp branch
    for (const pull of pulls) {
        console.log(`Merging Pull Request #${pull.number} into ${tempBranch}`);
        await octokit.request('POST /repos/{owner}/{repo}/merges', {
            owner: context.repo.owner,
            repo: context.repo.repo,
            base: tempBranch,
            head: pull.head.ref,
        });
        console.log(`Merged Pull Request #${pull.number} into ${tempBranch} successfully.`);
    }
    //get latest temp branch commit sha
    const { data: { commit: { sha: tempSha } } } = await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
        owner: context.repo.owner,
        repo: context.repo.repo,
        branch: tempBranch
    });
    try {
        const { data: integrationBranchData } = await octokit.request('GET /repos/{owner}/{repo}/branches/{integrationBranch}', {
            owner: context.repo.owner,
            repo: context.repo.repo,
            branch: tempBranch
        });
        console.log(`Updating branch ${integrationBranchName} from ${tempBranch} with commit sha: ${tempSha}.`);
        await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
            owner: context.repo.owner,
            repo: context.repo.repo,
            ref: `refs/heads/${integrationBranchName}`,
            sha: tempSha,
            force: true
        });
    } catch(e) {
        console.log(`Creating branch ${integrationBranchName} from ${tempBranch} with commit sha: ${tempSha}.`);
        await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
            owner: context.repo.owner,
            repo: context.repo.repo,
            ref: `refs/heads/${integrationBranchName}`,
            sha: tempSha
        });
    }
};
