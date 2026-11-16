function cohortValueInMillions(value) {
  const raw = String(value ?? "").replace(/[$,]/g, "").trim();
  const parsed = Number(raw.replace(/[MK]$/i, ""));
  if (!Number.isFinite(parsed)) return 0;
  return /K$/i.test(raw) ? parsed / 1000 : parsed;
}

function cohortGroup(cohort) {
  const slug = String(cohort.slug || "").toLowerCase();
  const label = String(cohort.cohort || "").trim().toLowerCase();
  if (/(?:^|_)(?:extremely_profitable|very_profitable|profitable)$/.test(slug)
      || /^(?:extremely |very )?profitable\b/.test(label)) return "profitable";
  if (/(?:^|_)(?:unprofitable|very_unprofitable|rekt)$/.test(slug)
      || /^(?:unprofitable|very unprofitable|rekt)\b/.test(label)) return "loss-making";
  return null;
}

function hasExposureValue(cohort, key) {
  const value = cohort[key];
  return value !== null && value !== undefined && String(value).trim() !== ""
    && !/unavailable/i.test(String(value));
}

function netShare(long, short) {
  const total = long + short;
  return total ? ((long - short) / total) * 100 : 0;
}

function cohortExposure(cohorts, group) {
  const rows = cohorts
    .filter((cohort) => cohortGroup(cohort) === group
      && cohort.values_available !== false
      && hasExposureValue(cohort, "long")
      && hasExposureValue(cohort, "short"))
    .map((cohort) => {
      const long = cohortValueInMillions(cohort.long);
      const short = cohortValueInMillions(cohort.short);
      return {
        cohort: cohort.cohort || cohort.slug || group,
        long,
        short,
        net: long - short,
        netSharePct: netShare(long, short),
      };
    });
  if (!rows.length) return null;

  const long = rows.reduce((sum, row) => sum + row.long, 0);
  const short = rows.reduce((sum, row) => sum + row.short, 0);
  return {
    long,
    short,
    net: long - short,
    netSharePct: netShare(long, short),
    rows,
  };
}

function signedMillions(value) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
}

function signedPct(value) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

function strongestCohort(exposure, direction) {
  const aligned = exposure.rows.filter((row) => direction === "long" ? row.net > 0 : row.net < 0);
  return aligned.sort((a, b) => Math.abs(b.net) - Math.abs(a.net))[0] || null;
}

function groupDescription(label, exposure, direction) {
  const netDescription = exposure.net > 0 ? "net long" : exposure.net < 0 ? "net short" : "balanced";
  const leader = strongestCohort(exposure, direction);
  const leaderDescription = leader
    ? `, led by ${leader.cohort} (${signedMillions(leader.net)} net, ${signedPct(leader.netSharePct)} net share)`
    : "";
  return `${label} are ${netDescription} ${signedMillions(exposure.net)} (${signedPct(exposure.netSharePct)} net share)${leaderDescription}`;
}

export function computeHyperdashSignal(currentCohorts = []) {
  const profitable = cohortExposure(currentCohorts, "profitable");
  const lossMaking = cohortExposure(currentCohorts, "loss-making");
  const profitableBias = Math.sign(profitable?.net || 0);
  const lossMakingBias = Math.sign(lossMaking?.net || 0);
  let directionScore = 0;
  let confidence = "low";
  let reason;

  if (profitableBias !== 0) {
    directionScore = profitableBias;
    if (profitableBias !== lossMakingBias && lossMakingBias !== 0) {
      directionScore += profitableBias;
      confidence = Math.min(Math.abs(profitable.netSharePct), Math.abs(lossMaking.netSharePct)) >= 25
        ? "high" : "medium";
      reason = `${groupDescription("Profitable cohorts", profitable, profitableBias > 0 ? "long" : "short")}; `
        + `${groupDescription("loss-making cohorts", lossMaking, lossMakingBias > 0 ? "long" : "short")}. `
        + `Profitable longs against loss-making shorts form a bullish split, so the read is UP.`;
      if (profitableBias < 0) {
        reason = `${groupDescription("Profitable cohorts", profitable, "short")}; `
          + `${groupDescription("loss-making cohorts", lossMaking, "long")}. `
          + `Profitable shorts against loss-making longs form a bearish split, so the read is DOWN.`;
      }
    } else {
      confidence = Math.abs(profitable.netSharePct) >= 40 ? "medium" : "low";
      const profitableDirection = profitableBias > 0 ? "long" : "short";
      const profitableRead = groupDescription("Profitable cohorts", profitable, profitableDirection);
      if (lossMakingBias === profitableBias && lossMaking) {
        const lossDirection = lossMakingBias > 0 ? "long" : "short";
        reason = `${profitableRead}; ${groupDescription("loss-making cohorts", lossMaking, lossDirection)} too. `
          + `There is no opposing cohort split; the read follows the profitable cohorts.`;
      } else {
        reason = `${profitableRead}. Loss-making cohort positioning is unavailable or balanced; the read follows the profitable cohorts.`;
      }
    }
  } else if (lossMakingBias !== 0 && lossMaking) {
    directionScore = -lossMakingBias;
    confidence = Math.abs(lossMaking.netSharePct) >= 40 ? "medium" : "low";
    const lossDirection = lossMakingBias > 0 ? "long" : "short";
    const direction = directionScore > 0 ? "UP" : "DOWN";
    reason = `${groupDescription("Loss-making cohorts", lossMaking, lossDirection)}; profitable cohort positioning is unavailable or balanced. `
      + `The read takes the opposing side of the loss-making cohort lean, so the read is ${direction} with low confirmation.`;
  } else {
    reason = "The current cohort table has no directional separation because both groups are balanced or unavailable. The interface requires an UP/DOWN label, so UP is a placeholder with very low confidence.";
  }

  return {
    direction: directionScore < 0 ? "DOWN" : "UP",
    confidence,
    basis: "current cohort table",
    reason,
    score: Number((profitable?.netSharePct || 0).toFixed(1)),
    profitable_net_share_pct: Number((profitable?.netSharePct || 0).toFixed(1)),
    loss_making_net_share_pct: Number((lossMaking?.netSharePct || 0).toFixed(1)),
  };
}
