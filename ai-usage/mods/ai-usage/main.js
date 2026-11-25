import { View, div, svg, image } from 'gpui-kit';
import { v_flex, h_flex, Scrollbar } from 'gpui-base';
import { appHome, readTextFile, exec, theme, openOverlay, props, checking } from 'herdr';

function dateLabel(value) {
  return value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not reported';
}

export default class AiUsage extends View {
  init(_props, cx) {
    this.topBar = props()?.topBar === true;
    this.compact = this.topBar || props()?.compact === true;
    this.root = `${appHome()}/mods/ai-usage`;
    this.data = null;
    this.busy = false;
    this.resetBusy = false;
    this.error = null;
    this.notice = null;
    this.confirmation = null;
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(60000, cx => this.refresh(cx));
  }

  async helper(action, payload) {
    const config = JSON.parse(await readTextFile(`${this.root}/config.json`) || '{}');
    if (!config.node) throw new Error('Set the Node executable in mods/ai-usage/config.json.');
    const args = [`${this.root}/helper.mjs`, action];
    if (payload) args.push(JSON.stringify(payload));
    const result = await exec(config.node, args, { cwd: this.root, timeout: 85000 });
    const lines = result.stdout.trim().split('\n');
    let output;
    try { output = JSON.parse(lines[lines.length - 1]); }
    catch { throw new Error(`Usage helper returned invalid data (exit ${result.code}, stdout ${result.stdout.length} chars, stderr ${result.stderr.length} chars). Check config.json and README.`); }
    if (result.code !== 0 || output.ok === false) throw new Error(output.error || 'Usage helper failed.');
    return output;
  }

  refresh(cx) {
    if (this.busy || this.resetBusy || this.confirmation) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async cx => {
      try { this.data = await this.helper('usage'); this.error = null; }
      catch (error) { this.error = String(error.message || error).slice(0, 700); this.data = null; }
      finally { this.busy = false; cx.notify(); }
    });
  }

  prepare(credit, cx) {
    if (this.busy || this.resetBusy || !this.data?.codex?.ok || this.error) return;
    this.resetBusy = true;
    this.notice = null;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await this.helper('prepare-reset', { accountId: this.data.codex.data.accountId, creditId: credit.id });
        this.confirmation = result.data;
      } catch (error) { this.notice = String(error.message || error); }
      finally { this.resetBusy = false; cx.notify(); }
    });
  }

  redeem(cx) {
    if (this.resetBusy || this.busy || !this.confirmation) return;
    const intent = this.confirmation.intent;
    this.resetBusy = true;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await this.helper('reset', intent);
        this.notice = result.data.message;
      } catch (error) {
        this.notice = `${String(error.message || error)} No automatic retry was made. Refresh to check for a pending attempt.`;
      } finally {
        this.confirmation = null;
        this.resetBusy = false;
        // Clear old quota/buttons immediately, then re-read authoritative state.
        this.data = null;
        this.refresh(cx);
        cx.notify();
      }
    });
  }

  details() {
    openOverlay({ mod: 'ai-usage', kind: 'dialog', width: 980, height: 740, props: { compact: false } });
  }

  orderedQuotas(data) {
    const quotas = data?.quotas || [];
    // Sort a copy; never mutate the provider snapshot used by another view.
    return [...quotas.filter(q => q.id === 'premium_interactions'),
      ...quotas.filter(q => q.id !== 'premium_interactions')];
  }

  openUsage(provider, cx) {
    const url = ({ codex: 'https://chatgpt.com/codex/settings/usage', copilot: 'https://github.com/settings/copilot' })[provider];
    cx.spawn(async cx => {
      try {
        const result = await exec('open', [url], { timeout: 10000 });
        if (result.code !== 0) throw new Error('Could not open the usage page.');
      } catch (error) { this.notice = String(error.message || error); cx.notify(); }
    });
  }

  button(id, label, action, enabled = true, primary = false) {
    const t = theme();
    return div().id(id).px(9).py(5).rounded(7).text_size(11)
      .bg(primary && enabled ? t.solid : t.raised).text_color(!enabled ? t.dim : primary ? t.solid_foreground : t.foreground)
      .when(enabled, e => e.cursor_pointer().hover(s => s.bg(primary ? t.accent : t.hover)).on_click(action))
      .child(label);
  }

  allowanceStyle(remaining, unlimited = false) {
    const t = theme();
    if (unlimited) return { color: t.ansi2, label: 'Unlimited' };
    if (remaining == null || !Number.isFinite(remaining)) return { color: t.dim, label: 'Unavailable' };
    if (remaining <= 20) return { color: t.ansi1, label: 'Critical' };
    if (remaining <= 50) return { color: t.ansi3, label: 'Low' };
    return { color: t.ansi2, label: 'Healthy' };
  }

  meter(id, label, remaining, resetAt = null, unlimited = false) {
    const t = theme();
    const { color, label: status } = this.allowanceStyle(remaining, unlimited);
    const known = remaining != null && Number.isFinite(remaining);
    return v_flex().flex_none().min_w(0).gap(6)
      .child(div().text_size(10).text_color(t.muted).child(label))
      .child(h_flex().items_end().gap(4)
        .child(div().text_size(this.compact ? 28 : 32).font_semibold().text_color(known || unlimited ? color : t.dim)
          .child(unlimited ? '∞' : known ? `${Math.round(remaining * 10) / 10}` : '—'))
        .when(known && !unlimited, e => e.child(div().pb(4).text_size(13).text_color(t.dim).child('%'))))
      .when(!unlimited, e => e.child(div().h(4).rounded(2).bg(t.raised).overflow_hidden()
        .child(div().id(`bar-${id}`).h_full().rounded(2).w(`${known ? Math.max(0, Math.min(100, remaining)) : 0}%`).bg(color))))
      .child(h_flex().items_center().gap(5)
        .child(div().w(4).h(4).rounded(2).bg(color))
        .child(div().text_size(10).text_color(t.muted).child(known && !unlimited ? `${status} · remaining` : status)))
      .when(!this.compact && !!resetAt, e => e.child(div().text_size(10).text_color(t.dim).child(`Resets ${dateLabel(resetAt)}`)));
  }

  providerHeader(provider, name, plan, action) {
    const t = theme();
    return h_flex().items_center().gap(8)
      .child(div().w(28).h(28).rounded(8).bg(t.raised).flex().items_center().justify_center()
        .child(this.providerIcon(provider, 18)))
      .child(div().flex_1().font_semibold().text_size(13).child(name))
      .when(!!plan, e => e.child(div().px(6).py(2).rounded(5).bg(t.raised).text_size(9).text_color(t.muted).child(plan)))
      .when(!this.compact, e => e.child(this.button(`${provider}-web`, 'Usage ↗', action)));
  }

  status(result) {
    const t = theme();
    if (!result) return div().text_color(t.dim).child(this.busy ? 'Loading allowance…' : 'Unavailable · Refresh to retry');
    if (!result.ok) return div().text_color(t.blocked).child(result.error);
    return null;
  }

  footer(result) {
    const t = theme();
    if (!result?.ok) return null;
    const stale = Date.now() - result.updatedAt > 120000;
    return div().text_size(10).text_color(stale ? t.blocked : t.dim)
      .child(`${stale ? 'Stale · ' : ''}Updated ${new Date(result.updatedAt).toLocaleTimeString()}`);
  }

  codexCard(cx) {
    const t = theme(), result = this.data?.codex, data = result?.ok ? result.data : null;
    return v_flex().flex_none().p(12).rounded(14).bg(t.surface).border_1().border_color(t.border).gap(12)
      .child(this.providerHeader('codex', 'Codex', data?.plan?.toUpperCase(), (_e, cx) => this.openUsage('codex', cx)))
      .when(!data, e => e.child(this.status(result)))
      .when(!!data, e => {
        e = e.when(!this.compact, el => el.child(div().text_color(t.dim).text_size(11).child(data.accountLabel)))
          .child(h_flex().gap(12).items_start()
            .child(div().flex_1().min_w(0).child(this.meter('codex-primary', '5-HOUR WINDOW', data.primary?.remaining ?? null, data.primary?.resetsAt)))
            .child(div().flex_1().min_w(0).child(this.meter('codex-secondary', 'WEEKLY LIMIT', data.secondary?.remaining ?? null, data.secondary?.resetsAt))))
          .child(h_flex().items_center().gap(6).pt(8).border_t_1().border_color(t.border)
            .child(div().flex_1().text_size(10).text_color(t.muted).child(data.resetCount == null ? 'Credits unavailable' : `${data.resetCount} reset credit${data.resetCount === 1 ? '' : 's'}`))
            .when(this.compact, el => el.child(this.button('usage-details', 'Manage ↗', () => this.details()))));
        if (!this.compact) {
          e = e.when(data.ordinaryUsageAllowed === false, el => el.child(div().text_color(t.blocked).child('Included usage is currently blocked.')))
            .when(!data.resetsSupported, el => el.child(div().text_color(t.dim).child('Reset-credit information is not supported or unavailable for this account.')))
            .when(data.resetCount > 0 && !data.credits.length, el => el.child(div().text_color(t.dim).child('Reset credit details unavailable. Refresh before redeeming.')))
            .when(!!data.pending, el => el.child(v_flex().p(10).gap(6).rounded(6).bg(t.raised)
              .child(div().text_color(t.blocked).child('A reset has an uncertain result. Do not spend another credit.'))
              .child(this.button('resolve-reset', 'Review same attempt…', (_e, cx) => {
                this.confirmation = { intent: data.pending, accountLabel: data.accountLabel, retry: true };
                cx.notify();
              }, !this.busy && !this.resetBusy && data.accountId === data.pending.accountId))))
            .when(!data.pending, el => el.children(data.credits.map((credit, i) => v_flex().gap(5).p(10).rounded(6).border_1().border_color(t.border)
              .child(div().font_semibold().child(credit.title))
              .child(div().text_color(t.dim).text_size(11).child(credit.expiresAt ? `Expires ${dateLabel(credit.expiresAt)}` : 'No expiry reported'))
              .child(this.button(`choose-reset-${i}`, 'Use this reset…', (_e, cx) => this.prepare(credit, cx), !this.busy && !this.resetBusy && !!data.accountId)))))
            .child(this.footer(result));
        }
        return e;
      });
  }

  copilotCard(cx) {
    const t = theme(), result = this.data?.copilot, data = result?.ok ? result.data : null;
    const ordered = this.orderedQuotas(data);
    const premium = ordered.find(q => q.id === 'premium_interactions');
    const quotas = this.compact ? (premium ? [premium] : ordered) : ordered;
    return v_flex().flex_none().p(12).rounded(14).bg(t.surface).border_1().border_color(t.border).gap(12)
      .child(this.providerHeader('copilot', 'Copilot', null, (_e, cx) => this.openUsage('copilot', cx)))
      .when(!data, e => e.child(this.status(result)))
      .when(!!data, e => e
        .when(!this.compact, el => el.child(div().text_color(t.dim).text_size(11).child(data.accountLabel)))
        .children(quotas.map(q => this.meter(`copilot-${q.id}`, ({ premium_interactions: 'Premium allowance', chat: 'Chat', completions: 'Completions' })[q.id] || q.id,
          q.remaining, null, q.unlimited)))
        .when(!quotas.length, el => el.child(div().text_color(t.dim).child('No quota categories reported.')))
        .when(!this.compact, el => el
          .child(div().text_color(t.dim).text_size(10).child('Provider-reported allowance. Billing units and reset time are not inferred.'))
          .child(this.footer(result))));
  }

  providerIcon(provider, size) {
    if (provider === 'codex') return image('icons/codex.svg').w(size).h(size);
    return svg('icons/copilot.svg').w(size).h(size).text_color(theme().foreground);
  }

  confirmationView(cx) {
    const t = theme(), c = this.confirmation;
    return v_flex().p(14).gap(12).rounded(8).border_1().border_color(t.accent).bg(t.surface)
      .child(div().font_semibold().text_size(15).child(c.retry ? 'Resolve the same reset attempt?' : 'Use one Codex reset?'))
      .child(div().text_color(t.muted).child(`Account: ${c.accountLabel}`))
      .child(div().text_color(t.dim).text_size(10).child(`Credit: ${c.intent.creditId}`))
      .child(div().child(c.retry ? 'This resends the saved idempotent request for the same credit. It does not select a new credit.' : 'This spends one available reset credit to reset both your weekly and five-hour limits.'))
      .when(!!c.credit, e => e.child(div().text_color(t.muted).child(`${c.credit.title}\nExpires ${dateLabel(c.credit.expiresAt)}`)))
      .when(this.resetBusy, e => e.child(div().text_color(t.accent).child('Waiting for Codex… Do not retry elsewhere.')))
      .child(h_flex().gap(8).flex_wrap()
        .child(this.button('confirm-reset', c.retry ? 'Retry same attempt' : 'Yes, use one reset', (_e, cx) => this.redeem(cx), !this.resetBusy && !this.busy, true))
        .child(this.button('cancel-reset', 'Cancel', (_e, cx) => { this.confirmation = null; this.refresh(cx); cx.notify(); }, !this.resetBusy)));
  }

  summary(provider) {
    const t = theme(), result = this.data?.[provider], data = result?.ok ? result.data : null;
    const codex = provider === 'codex';
    const quota = data && !codex ? this.orderedQuotas(data)[0] : null;
    const readings = codex
      ? [{ label: '5-hour', remaining: data?.primary?.remaining }, { label: 'Weekly', remaining: data?.secondary?.remaining }]
      : [{ label: quota?.id === 'premium_interactions' ? 'Premium' : 'Allowance', remaining: quota?.remaining, unlimited: quota?.unlimited === true }];
    return h_flex().flex_none().h(46).px(12).items_center().gap(12)
      .rounded(11).bg(t.surface).border_1().border_color(t.border)
      .child(this.providerIcon(provider, 20))
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child(codex ? 'Codex' : 'Copilot'))
      .child(div().w(1).h(24).bg(t.border))
      .children(readings.map(reading => {
        const style = this.allowanceStyle(reading.remaining, reading.unlimited);
        const known = reading.remaining != null && Number.isFinite(reading.remaining);
        const value = reading.unlimited ? 'Unlimited' : known
          ? `${Math.round(reading.remaining * 10) / 10}%` : this.busy ? '…' : '—';
        return h_flex().items_center().gap(7)
          .child(div().text_size(11).text_color(t.muted).child(reading.label))
          .child(div().text_size(18).font_semibold().text_color(style.color).child(value));
      }));
  }

  renderTop(cx) {
    const t = theme();
    return h_flex().size_full().min_w(0).h(64).px(12).items_center().gap(12)
      .bg(t.chrome).text_color(t.foreground).text_size(11)
      .child(v_flex().flex_none().gap(2)
        .child(div().font_semibold().text_size(13).child('AI usage'))
        .child(div().text_size(10).text_color(t.dim).child('Remaining')))
      .child(h_flex().id('usage-mini-scroll').flex_1().min_w(0).items_center().gap(10).overflow_x_scrollbar()
        .child(this.summary('codex')).child(this.summary('copilot')))
      .when(!!this.error, e => e.child(div().text_color(t.blocked).text_size(10).child('Usage unavailable')))
      .child(div().flex_none().child(this.button('top-details', 'Details ↗', () => this.details())));
  }

  render(cx) {
    if (this.topBar) return this.renderTop(cx);
    const t = theme();
    return v_flex().size_full().min_w(0).min_h(0).bg(t.background).text_color(t.foreground).text_size(this.compact ? 11 : 12)
      .child(h_flex().flex_none().px(10).py(8).items_center().gap(5)
        .child(v_flex().flex_1().gap(2)
          .child(div().font_semibold().text_size(12).child('AI usage'))
          .child(div().text_size(9).text_color(t.dim).child('ALLOWANCE OVERVIEW')))
        .when(this.compact, e => e.child(this.button('open-dashboard', '↗', () => this.details())))
        .child(this.button('refresh-usage', this.busy ? '…' : '↻', (_e, cx) => this.refresh(cx), !this.busy && !this.resetBusy && !this.confirmation)))
      .child(div().flex_1().min_h(0).relative()
        .child(v_flex().id('usage-scroll').absolute().inset_0().overflow_y_scroll().px(10).pb(10).gap(this.compact ? 12 : 16)
          .when(!!this.error, e => e.child(div().text_color(t.blocked).child(this.error)))
          .when(!!this.notice && !this.compact, e => e.child(div().p(8).rounded(5).bg(t.raised).child(this.notice)))
          .when(!!this.confirmation, e => e.child(this.confirmationView(cx)))
          .when(!this.confirmation && !this.compact, e => e.child(h_flex().flex_none().items_start().gap(16)
            .child(div().flex_1().min_w(0).child(this.codexCard(cx)))
            .child(div().flex_1().min_w(0).child(this.copilotCard(cx)))))
          .when(!this.confirmation && this.compact, e => e.child(this.codexCard(cx)).child(this.copilotCard(cx)))
          .when(this.compact, e => e.child(div().text_size(10).text_color(t.dim).child('Updates every minute · Manage for reset details'))))
        .child(Scrollbar.vertical('usage-scroll').absolute().inset_0()));
  }
}
