import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { inferPRBody } from '../../src/actions/submit/pr_body';
import { getPRTitle } from '../../src/actions/submit/pr_title';
import {
  footerFooter,
  footerTitle,
  wrapFooter,
} from '../../src/actions/create_pr_body_footer';
import {
  shouldUpdatePrFooter,
  updatePrBodyFooter,
} from '../../src/actions/submit/submit_action';
import { validateNoEmptyBranches } from '../../src/actions/submit/validate_branches';
import { BasicScene } from '../lib/scenes/basic_scene';
import { configureTest } from '../lib/utils/configure_test';

use(chaiAsPromised);

for (const scene of [new BasicScene()]) {
  describe(`(${scene}): correctly infers submit info from commits`, function () {
    configureTest(this, scene);

    it('can infer title/body from single commit', async () => {
      const title = 'Test Title';
      const body = ['Test body line 1.', 'Test body line 2.'].join('\n');
      const message = `${title}\n\n${body}`;

      scene.repo.createChange('a');
      scene.repo.runCliCommand([`create`, `a`, `-m`, message]);

      expect(
        await getPRTitle(
          { branchName: 'a', editPRFieldsInline: false },
          scene.getContext()
        )
      ).to.equals(title);
      expect(
        inferPRBody(
          { branchName: 'a', template: 'template' },
          scene.getContext()
        ).inferredBody
      ).to.equals(`template`);

      scene
        .getContext()
        .userConfig.update((data) => (data.submitIncludeCommitMessages = true));

      expect(
        await getPRTitle(
          { branchName: 'a', editPRFieldsInline: false },
          scene.getContext()
        )
      ).to.equals(title);
      expect(
        inferPRBody(
          { branchName: 'a', template: 'template' },
          scene.getContext()
        ).inferredBody
      ).to.equals(`${body}\n\ntemplate`);
    });

    it('can infer just title with no body', async () => {
      const title = 'Test Title';
      const commitMessage = title;

      scene.repo.createChange('a');
      scene.repo.runCliCommand([`create`, `a`, `-m`, commitMessage]);

      expect(
        await getPRTitle(
          { branchName: 'a', editPRFieldsInline: false },
          scene.getContext()
        )
      ).to.equals(title);
      expect(
        inferPRBody(
          { branchName: 'a', template: 'template' },
          scene.getContext()
        ).inferredBody
      ).to.equal('template');
    });

    it('can infer title/body from multiple commits', async () => {
      const title = 'Test Title';
      const secondSubj = 'Second commit subject';

      scene.repo.createChange('a');
      scene.repo.runCliCommand([`create`, `a`, `-m`, title]);
      scene.repo.createChangeAndCommit(secondSubj);

      expect(
        await getPRTitle(
          { branchName: 'a', editPRFieldsInline: false },
          scene.getContext()
        )
      ).to.equals(title);
      expect(
        inferPRBody({ branchName: 'a' }, scene.getContext()).inferredBody
      ).to.equal(``);

      scene
        .getContext()
        .userConfig.update((data) => (data.submitIncludeCommitMessages = true));

      expect(
        await getPRTitle(
          { branchName: 'a', editPRFieldsInline: false },
          scene.getContext()
        )
      ).to.equals(title);
      expect(
        inferPRBody({ branchName: 'a' }, scene.getContext()).inferredBody
      ).to.equal(`${title}\n\n${secondSubj}`);
    });

    it('aborts if the branch is empty', async () => {
      scene.repo.runCliCommand([`create`, `a`, `-m`, `a`]);
      await expect(validateNoEmptyBranches(['a'], scene.getContext())).to.be
        .rejected;
    });

    it('does not abort if the branch is not empty', async () => {
      scene.repo.createChange('a');
      scene.repo.runCliCommand([`create`, `a`, `-m`, `a`]);
      await expect(validateNoEmptyBranches(['a'], scene.getContext())).to.be
        .fulfilled;
    });
  });
}

describe('updatePrBodyFooter', () => {
  // Use the real footer format (leading newlines from footerTitle), unlike the
  // simplified literal the original test used.
  const rawFooter = `${footerTitle}* **PR #83** 👈${footerFooter}`;
  const newFooter = wrapFooter(rawFooter);
  const footerCount = (s: string) =>
    (s.match(/#### PR Dependency Tree/g) ?? []).length;
  const description = `Some PR description

**Changes In This Pull Request:**`;

  it('returns the (marker-wrapped) footer when there is no body', () => {
    expect(updatePrBodyFooter(undefined, rawFooter)).to.equal(newFooter);
  });

  it('appends the marker-wrapped footer when the body has none', () => {
    expect(updatePrBodyFooter(description, rawFooter)).to.equal(
      description + newFooter
    );
  });

  it('replaces an existing wrapped footer rather than appending a second', () => {
    const existing = description + newFooter;
    const result = updatePrBodyFooter(existing, rawFooter);
    expect(result).to.equal(existing);
    expect(footerCount(result)).to.equal(1);
  });

  it('does not duplicate the footer when content was appended after it', () => {
    // e.g. an external bot appended a section after Charcoal's footer (#118)
    const existing = `${description}${newFooter}\n\n---\n_posted by a bot_`;
    const result = updatePrBodyFooter(existing, rawFooter);
    expect(footerCount(result)).to.equal(1);
    expect(result).to.contain('_posted by a bot_');
    expect(result.endsWith(newFooter)).to.equal(true);
  });

  it('collapses an already-duplicated footer to a single one', () => {
    const existing = `${description}${newFooter}${newFooter}`;
    const result = updatePrBodyFooter(existing, rawFooter);
    expect(footerCount(result)).to.equal(1);
    expect(result).to.equal(description + newFooter);
  });

  it('migrates a pre-upgrade unmarked footer to the marker-wrapped form', () => {
    // A body written by a Charcoal version from before separator markers
    // existed has the raw footer with no <!-- charcoal:footer:* --> markers.
    const existing = description + rawFooter;
    const result = updatePrBodyFooter(existing, rawFooter);
    expect(footerCount(result)).to.equal(1);
    expect(result).to.equal(description + newFooter);
  });

  it('replaces a custom-template footer using only the separator markers', () => {
    // Custom templates never contain footerTitle/footerFooter text, so only
    // the markers -- not any hardcoded text -- can anchor the old footer.
    const oldCustomFooter = 'Auto-generated by charcoal: 1 PRs\n1. #83 b';
    const newCustomFooter = 'Auto-generated by charcoal: 2 PRs\n1. #83 b';
    const existing = description + wrapFooter(oldCustomFooter);

    const result = updatePrBodyFooter(existing, newCustomFooter);

    expect(result).to.equal(description + wrapFooter(newCustomFooter));
  });
});

describe('shouldUpdatePrFooter', () => {
  const rawFooter = `${footerTitle}* **PR #83** 👈${footerFooter}`;
  const description = `Some PR description

**Changes In This Pull Request:**`;

  it('is true when there is no body', () => {
    expect(shouldUpdatePrFooter(undefined, rawFooter)).to.equal(true);
  });

  it('is true when the body has no footer at all', () => {
    expect(shouldUpdatePrFooter(description, rawFooter)).to.equal(true);
  });

  it('is false for an unchanged pre-upgrade unmarked footer', () => {
    // Don't force a marker-only rewrite of every PR in a stack the first
    // time someone upgrades -- only touch it once real content changes.
    const body = description + rawFooter;
    expect(shouldUpdatePrFooter(body, rawFooter)).to.equal(false);
  });

  it('is true when a pre-upgrade unmarked footer is stale', () => {
    const staleFooter = `${footerTitle}* **PR #1** 👈${footerFooter}`;
    const body = description + staleFooter;
    expect(shouldUpdatePrFooter(body, rawFooter)).to.equal(true);
  });

  it('is false for an unchanged marker-wrapped footer', () => {
    const body = description + wrapFooter(rawFooter);
    expect(shouldUpdatePrFooter(body, rawFooter)).to.equal(false);
  });

  it('is true when a marker-wrapped footer is stale', () => {
    const staleFooter = `${footerTitle}* **PR #1** 👈${footerFooter}`;
    const body = description + wrapFooter(staleFooter);
    expect(shouldUpdatePrFooter(body, rawFooter)).to.equal(true);
  });
});
