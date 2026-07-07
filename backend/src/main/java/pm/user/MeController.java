package pm.user;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import pm.auth.CurrentUser;
import pm.tenantadmin.MembershipRepository;
import pm.tenantadmin.TenantRepository;

import java.util.List;

@RestController
@RequestMapping("/api/me")
public class MeController {

    private final MembershipRepository memberships;
    private final TenantRepository tenants;

    public MeController(MembershipRepository memberships, TenantRepository tenants) {
        this.memberships = memberships;
        this.tenants = tenants;
    }

    public record TenantView(String slug, String name, String role) {
    }

    @GetMapping("/tenants")
    List<TenantView> myTenants() {
        long userId = CurrentUser.id();
        return memberships.findByUserId(userId).stream()
                .map(m -> {
                    var tenant = tenants.findById(m.getTenantId()).orElseThrow();
                    return new TenantView(tenant.getSlug(), tenant.getName(), m.getRole().name());
                })
                .toList();
    }
}
