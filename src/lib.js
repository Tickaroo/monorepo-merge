import { context } from '@actions/github';
import { getInput, setFailed } from '@actions/core';

/**
 * groupLabeledPullRequests
 * @description Fetches all PRs from repo with target label and merge each one to a temp branch.
 * @arg octokit Github Octokit Rest client
 * @return pulls[] Array of grouped pull request objects
 */
export const groupLabeledPullRequests = async function (octokit) {
    try {
        //get input from Github Job declaration
        var pulls = [];
        var comment = '## Trying to merge Pull Requests:\n';
        const label = getInput('target-label');
        const excludeCurrent = getInput('exclude-current');
        //Create search query
        const q = `is:pull-request label:${label} repo:${context.repo.owner}/${context.repo.repo} state:open`;
        //Call github API through the octokit client
        const { data } = await octokit.search.issuesAndPullRequests({
            q,
            sort: 'created',
            order: 'desc',
        });
        //Exclude the current branch, so we will build the default.
        if(excludeCurrent === "true" && data.total_count <= 0) {
            return "default";
        }
        //Fetch the current pull request
        const splitUrl = context.payload.comment.issue_url.split('/');
        const currentIssueNumber = parseInt(splitUrl[splitUrl.length - 1], 10)
        const { data: currentPull } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
            owner: context.repo.owner,
            repo: context.repo.repo,
            pull_number: currentIssueNumber
        });
        // Nothing to iterate. Just add the current pull data to merge
        if(excludeCurrent !== 'true' && data.total_count <= 0) {
            comment += `- ${currentPull.html_url}\n`;
            createComment(octokit, currentIssueNumber, comment);
            return [currentPull];
        }
        //iterate over selected PRs
        if(data.total_count > 0) {
            if(excludeCurrent !== 'true') {
                console.log('Pushing current PR to array');
                comment += `- ${currentPull.html_url}\n`;
                pulls.push(currentPull)
            }
            for (const item of data.items) {
                if (item.number !== currentIssueNumber) {
                    const accPull = await octokit.request(`GET /repos/{owner}/{repo}/pulls/{pull_number}`, {
                        owner: context.repo.owner,
                        repo: context.repo.repo,
                        pull_number: item.number
                    });
                    console.log(`Pushing External PR #${item.number} to array`);
                    comment += `- ${item.html_url}\n`;
                    pulls.push(accPull.data);
                }
            }
        }
        await createComment(octokit, currentIssueNumber, comment);
        await mergeBranches(octokit, pulls);
    } catch (e) {
        if (e.message === "Merge conflict") {
            console.log("Merge conflict error.")
            //Add label
        }
        const message = `:ghost: Merge failed with error:\n\`\`\`shell\n${e.message}\n\`\`\``;
        createComment(octokit, pull_number, message);
        setFailed(e.message);
    }
};

/**
 * mergeBranches
 * @description Merge the the head branches in a PR array into a temp branch.
 * @arg pulls Array of pullr request objects.
 * @arg octokit Github Octokit Rest client.
 */
const mergeBranches = async function (octokit, pulls) {
    //get latest main branch sha.
    const mainBranchName = getInput('main-branch');
    const integrationBranchName = getInput('integration-branch');
    const { data: { commit: { sha } } } = await octokit.request('GET /repos/{owner}/{repo}/branches/{branch}', {
        owner: context.repo.owner,
        repo: context.repo.repo,
        branch: mainBranchName
    });
    //create temp branch from main branch.
    const tmpBranchName = `integration-${context.repo.repo}-${Date.now()}`;
    await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
        owner: context.repo.owner,
        repo: context.repo.repo,
        ref: `refs/heads/${tmpBranchName}`,
        sha: sha
    });
    //merge group branches to tmp branch
    for (const pull of pulls) {
        const { head: { ref: headBranch }, number } = pull;
        console.log(`Merging Pull Request #${number} into ${tmpBranchName}`);
        await octokit.request('POST /repos/{owner}/{repo}/merges', {
            owner: context.repo.owner,
            repo: context.repo.repo,
            base: tmpBranchName,
            head: headBranch,
        });
        console.log(`Merged Pull Request #${number} into ${tmpBranchName} successfully.`);
    }
    //merge into integration branch
    console.log(`Merging branch #${tmpBranchName} into ${integrationBranchName}.`);
    await octokit.request('POST /repos/{owner}/{repo}/merges', {
        owner: context.repo.owner,
        repo: context.repo.repo,
        base: integrationBranchName,
        head: tmpBranchName,
    });
    console.log(`Merged branch #${tmpBranchName} into ${integrationBranchName} successfully.`);
};

/**
 * createComment
 * @description Create a comment in the current PR
 * @arg octokit Github Octokit client
 * @arg pull PR number
 * @arg message The comment message to show in PR
 */
const createComment = async function(octokit, pull, message) {
    try {
        await octokit.issues.createComment({
            owner: context.repo.owner,
            repo: context.repo.repo,
            issue_number: pull,
            body: message,
          });
    } catch(e) {
        console.log('Error creating comment')
        console.log(e.message);
    }
};
