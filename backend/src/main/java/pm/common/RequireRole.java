package pm.common;

import pm.tenantadmin.Membership;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 权限矩阵 harness：标在 /api/t/** 控制器方法上，声明该端点要求的最低租户角色。
 * 由 {@link RequireRoleInterceptor} 在 TenantInterceptor 之后统一校验，
 * 角色不足一律 403 {code: FORBIDDEN, message: 仅管理员可操作}（跨租户/非成员仍由 TenantInterceptor 给 404）。
 * 未标注的写端点必须出现在 WritePermissionMatrixTest 的「全员可写」白名单里，否则架构测试失败。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequireRole {

    Membership.Role value() default Membership.Role.ADMIN;
}
