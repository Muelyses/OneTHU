export class LibError extends Error {
    constructor(message?: string) {
        super(message);
    }
}

export class LoginError extends LibError {
    constructor(message?: string) {
        super(message);
    }
}

export type LoginPreparationReason =
    | "missing-public-key"
    | "invalid-public-key"
    | "empty-response"
    | "access-restricted"
    | "gateway-unavailable"
    | "trust-limit"
    | "unexpected-page"
    | "unsafe-confirmation"
    | "confirmation-loop";

/** Safe, machine-readable login diagnostics. Never attach response HTML or session URLs. */
export class LoginPreparationError extends LoginError {
    readonly code = "AUTH_PREPARATION_FAILED";
    constructor(
        readonly reason: LoginPreparationReason,
        readonly stage: "credential-entry" | "trusted-confirmation" = "credential-entry",
    ) {
        super("Unable to prepare the university login form.");
        this.name = "LoginPreparationError";
    }
}

export class UrlError extends LibError {

}

export class ReportError extends LibError {
    constructor(message?: string) {
        super(message);
    }
}

export class ProgramError extends LibError {
    constructor(message?: string) {
        super(message);
    }
}

export class AssessmentError extends LibError {
    constructor(message?: string) {
        super(message);
    }
}

export class ClassroomStateError extends LibError {

}

export class EleError extends LibError {

}

export class LibraryError extends LibError {
    constructor(message?: string) {
        super(message);
    }
}

export class SportsError extends LibError {
    constructor(message?: string) {
        super(message);
    }
}

export class DormAuthError extends LibError {

}

export class IdAuthError extends LibError {

}

export class CabError extends LibError {

}

export class CabTimeoutError extends CabError {

}

export class CabNotActivatedError extends CabError {

}

export class UserInfoError extends LibError {

}

export class UseregAuthError extends LibError {

}

export class ResponseStatusError extends LibError {
    constructor(message?: string) {
        super(message);
    }
}

export class GitLabApiError extends LibError {

}

export class ScheduleError extends LibError {

}

export class CrError extends LibError {

}

export class CrCaptchaError extends CrError {

}

export class CrTimeoutError extends CrError {

}
