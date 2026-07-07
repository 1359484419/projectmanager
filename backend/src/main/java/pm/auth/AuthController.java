package pm.auth;

import jakarta.validation.constraints.NotBlank;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
@Validated
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    public record RegisterRequest(@NotBlank String email, @NotBlank String password,
                                  @NotBlank String displayName, @NotBlank String tenantName,
                                  @NotBlank String tenantSlug) {
    }

    public record LoginRequest(@NotBlank String email, @NotBlank String password) {
    }

    public record RefreshRequest(@NotBlank String refreshToken) {
    }

    @PostMapping("/register")
    AuthService.TokenPair register(@RequestBody @Validated RegisterRequest req) {
        return authService.register(req.email(), req.password(), req.displayName(),
                req.tenantName(), req.tenantSlug());
    }

    @PostMapping("/login")
    AuthService.TokenPair login(@RequestBody @Validated LoginRequest req) {
        return authService.login(req.email(), req.password());
    }

    @PostMapping("/refresh")
    AuthService.TokenPair refresh(@RequestBody @Validated RefreshRequest req) {
        return authService.refresh(req.refreshToken());
    }
}
