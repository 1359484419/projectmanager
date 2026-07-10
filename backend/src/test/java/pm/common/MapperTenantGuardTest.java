package pm.common;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.w3c.dom.Comment;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 多租户隔离架构测试（harness 兜底层）：
 * 迁移到 MyBatis 后没有 Hibernate @Filter 自动追加租户条件，
 * 隔离完全依赖每条 SQL 显式写 tenant_id —— 本测试扫描 classpath 全部 Mapper XML，
 * 凡 <select|update|delete> 涉及租户表的语句必须包含 "tenant_id"。
 *
 * 豁免机制：语句元素内部、或紧邻语句前的 XML 注释写
 *   <!-- tenant-guard-exempt: 理由 -->
 * （如 PAT 按 hash 全局查、SprintRotationJob 跨租户遍历、/api/me 个人资源）。
 */
class MapperTenantGuardTest {

    /** 租户表清单（users/tenants/refresh_tokens 为全局表，不在此列）。 */
    private static final Set<String> TENANT_TABLES = Set.of(
            "projects", "epics", "tasks", "activities", "comments", "subtasks", "sprints",
            "capacity_overrides", "invites", "api_tokens", "memberships");

    private static final String EXEMPT_MARKER = "tenant-guard-exempt";

    private static final Set<String> STATEMENT_TAGS = Set.of("select", "update", "delete");

    @Test
    void everyStatementOnTenantTablesCarriesTenantId() throws Exception {
        Resource[] xmls = new PathMatchingResourcePatternResolver()
                .getResources("classpath*:mapper/*.xml");
        assertThat(xmls).as("mapper XML 应该在 classpath:mapper/ 下").isNotEmpty();

        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        // mybatis DTD 不联网解析
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);

        List<String> violations = new ArrayList<>();
        int checked = 0;
        for (Resource xml : xmls) {
            Document doc;
            try (var in = xml.getInputStream()) {
                doc = factory.newDocumentBuilder().parse(in);
            }
            Element mapper = doc.getDocumentElement();
            NodeList children = mapper.getChildNodes();
            for (int i = 0; i < children.getLength(); i++) {
                Node node = children.item(i);
                if (!(node instanceof Element stmt)
                        || !STATEMENT_TAGS.contains(stmt.getTagName())) {
                    continue;
                }
                String sql = stmt.getTextContent().toLowerCase(Locale.ROOT);
                List<String> tables = tenantTablesIn(sql);
                if (tables.isEmpty()) {
                    continue;
                }
                checked++;
                if (sql.contains("tenant_id")) {
                    continue;
                }
                if (isExempt(stmt)) {
                    continue;
                }
                violations.add(xml.getFilename() + " -> <" + stmt.getTagName()
                        + " id=\"" + stmt.getAttribute("id") + "\"> 涉及租户表 " + tables
                        + " 但缺少 tenant_id 条件（如确属跨租户设计，请加注释 <!-- "
                        + EXEMPT_MARKER + ": 理由 -->）");
            }
        }
        assertThat(checked).as("至少应扫到一条涉及租户表的语句（防解析失效导致测试空转）").isPositive();
        assertThat(violations)
                .as("租户表语句缺少 tenant_id 条件（多租户隔离风险）：%n%s", String.join("\n", violations))
                .isEmpty();
    }

    /** 语句 SQL 文本里出现的租户表（词边界匹配，避免列名/子串误报）。 */
    private static List<String> tenantTablesIn(String sql) {
        List<String> hit = new ArrayList<>();
        for (String table : TENANT_TABLES) {
            if (Pattern.compile("\\b" + table + "\\b").matcher(sql).find()) {
                hit.add(table);
            }
        }
        return hit;
    }

    /** 豁免：语句元素内部注释，或紧邻语句前的注释（中间只允许空白文本），含标记即豁免。 */
    private static boolean isExempt(Element stmt) {
        NodeList children = stmt.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            if (children.item(i) instanceof Comment c
                    && c.getData().contains(EXEMPT_MARKER)) {
                return true;
            }
        }
        Node prev = stmt.getPreviousSibling();
        while (prev != null && prev.getNodeType() == Node.TEXT_NODE
                && prev.getTextContent().isBlank()) {
            prev = prev.getPreviousSibling();
        }
        return prev instanceof Comment c && c.getData().contains(EXEMPT_MARKER);
    }
}
