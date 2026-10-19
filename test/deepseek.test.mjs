import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWithDeepSeek } from '../src/deepseek.mjs';

const pages = [{ page: 1, text: '论文标题：校园导视研究。研究问题：新生如何寻找服务窗口？' }];
const analysis = {
  title: '校园导视研究',
  outlineRationale: '论文主要讨论导视问题，因此围绕问题和方法展开。',
  sections: Object.fromEntries(['background', 'question', 'method', 'design', 'results', 'conclusion']
    .map(key => [key, { text: key === 'question' ? '新生如何寻找服务窗口？' : '原文未明确说明', page: key === 'question' ? 1 : null }])),
  guide: {
    paperInfo: [{ text: '论文标题：校园导视研究', page: 1, basis: 'source' }],
    relatedWork: [], researchGoal: [{ text: '新生如何寻找服务窗口？', page: 1, basis: 'source' }],
    researchRoute: [], researchMethod: [], findings: [], conclusions: [], oneMinute: [], logicChain: []
  },
  slides: [{ title: '研究问题', message: '新生寻找服务窗口的困难', bullets: ['导视线索不清晰'], pages: [1], layout: 'statement' }]
};

test('DeepSeek 请求使用服务端密钥、论文文本与结构化大纲格式', async () => {
  let request;
  const result = await analyzeWithDeepSeek(pages, {
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }] })
      };
    }
  });
  assert.equal(request.url, 'https://api.deepseek.com/responses');
  assert.equal(request.options.headers.authorization, 'Bearer test-key');
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.max_output_tokens, 16000);
  assert.equal(body.text.format.type, 'json_schema');
  assert.ok(body.text.format.schema.properties.guide);
  assert.match(body.input[0].content, /图表编号/);
  assert.match(body.input[0].content, /基于原文/);
  assert.match(body.input[1].content, /新生如何寻找服务窗口/);
  assert.equal(result.mode, 'ai');
  assert.equal(result.provider, 'DeepSeek');
  assert.equal(result.slides[0].title, '研究问题');
  assert.equal(result.guide.researchGoal[0].page, 1);
});

test('DeepSeek 未完成回复时不把半截结果作为大纲', async () => {
  await assert.rejects(
    analyzeWithDeepSeek(pages, { apiKey: 'test-key', fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }) }) }),
    /输出达到本次字数上限/
  );
});
