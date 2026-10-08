// GET /api/data → everything the dashboard shows, read live from Notion.
const { DS, queryAll, prop, pid, send, checkKey, fail } = require("../lib/notion");

const dashed = id => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

module.exports = async (req, res) => {
  if (!checkKey(req, res)) return;
  try {
    const [trackerPages, projectPages, boardPages] = await Promise.all([
      queryAll(DS.tracker, { filter: { property: "Stage", select: { does_not_equal: "Offboarded" } } }, 5),
      queryAll(DS.projects, { filter: { property: "Client", relation: { is_not_empty: true } } }, 5),
      queryAll(DS.board, { sorts: [{ timestamp: "created_time", direction: "descending" }] }, 4)
    ]);

    const clients = trackerPages
      .map(p => ({
        id: pid(p),
        name: prop(p, "Client Name"),
        stage: prop(p, "Stage"),
        type: prop(p, "Project Type"),
        pstage: prop(p, "Project Stage"),
        addons: prop(p, "Upsells / Add-ons Purchased") || [],
        slack: prop(p, "Slack Channel ID"),
        start: prop(p, "Strategy Call Date"),
        deck: prop(p, "Strategy Deck"),
        issue: prop(p, "Specific Issue"),
        po: prop(p, "PO Name"),
        strat: prop(p, "Strat Team Member")
      }))
      .filter(c => c.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    const projects = projectPages.map(p => ({
      id: pid(p),
      name: prop(p, "Project name"),
      status: prop(p, "Status"),
      due: prop(p, "Due"),
      clientIds: prop(p, "Client") || []
    }));

    // Tasks that belong to any linked project. Notion allows up to 100 conditions in one OR, so chunk by 50.
    let tasks = [];
    for (let i = 0; i < projects.length; i += 50) {
      const chunk = projects.slice(i, i + 50);
      const pages = await queryAll(DS.tasks, {
        filter: {
          and: [
            { property: "Status", status: { does_not_equal: "Archived" } },
            { or: chunk.map(p => ({ property: "Project", relation: { contains: dashed(p.id) } })) }
          ]
        }
      }, 5);
      tasks = tasks.concat(pages.map(p => ({
        id: pid(p),
        name: prop(p, "Task name"),
        status: prop(p, "Status") || "Not started",
        due: prop(p, "Due"),
        projectIds: prop(p, "Project") || [],
        stage: prop(p, "Funnel Stage"),
        priority: prop(p, "Priority")
      })));
    }

    const board = boardPages.map(p => ({
      id: pid(p),
      title: prop(p, "Project Title"),
      client: prop(p, "Client Name"),
      type: prop(p, "Project Type"),
      status: prop(p, "Status"),
      deck: prop(p, "Strategy Deck link "),
      final: prop(p, "Final Link"),
      goal: prop(p, "Client Goal"),
      brief: prop(p, "Client Brief")
    }));

    // Optional: ad numbers and upsell checkpoints, once their Notion databases exist.
    let ads = null, upsell = null;
    if (process.env.AD_LOG_DS_ID) {
      const pages = await queryAll(process.env.AD_LOG_DS_ID, {
        filter: { property: "Date", date: { on_or_after: daysAgo(120) } },
        sorts: [{ property: "Date", direction: "descending" }]
      }, 5);
      ads = pages.map(p => ({
        id: pid(p),
        clientId: (prop(p, "Client") || [])[0] || null,
        date: prop(p, "Date"),
        spend: prop(p, "Spend") || 0,
        results: prop(p, "Results") || 0,
        resultLabel: prop(p, "Result Type") || "Leads",
        currency: prop(p, "Currency") || "USD",
        note: prop(p, "Note") || ""
      }));
    }
    if (process.env.UPSELL_DS_ID) {
      const pages = await queryAll(process.env.UPSELL_DS_ID, {}, 3);
      upsell = {};
      pages.forEach(p => {
        const cid = (prop(p, "Client") || [])[0];
        if (cid) upsell[cid] = { pageId: pid(p), nextDate: prop(p, "Next Date"), offer: prop(p, "Offer") || "", status: (prop(p, "Status") || "Planned").toLowerCase(), note: prop(p, "Note") || "" };
      });
    }

    send(res, 200, { clients, projects, tasks, board, ads, upsell, loadedAt: new Date().toISOString() }, 30);
  } catch (e) {
    fail(res, e);
  }
};
