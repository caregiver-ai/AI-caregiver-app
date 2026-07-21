import { randomUUID } from "crypto";
import { createSupabaseServerClient } from "@/lib/supabase";

export async function resolvePublicUser(authUser: { id: string; email?: string | null }) {
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    throw new Error("Supabase server client is not configured.");
  }

  const email = authUser.email?.trim().toLowerCase();
  if (!email) {
    throw new Error("Authenticated user is missing an email address.");
  }

  let { data: userRecord, error: userLookupError } = await supabase
    .from("users")
    .select("id, email, auth_user_id")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();

  if (userLookupError) {
    throw new Error(userLookupError.message);
  }

  if (!userRecord) {
    const { data: emailMatchedUser, error: emailLookupError } = await supabase
      .from("users")
      .select("id, email, auth_user_id")
      .eq("email", email)
      .maybeSingle();

    if (emailLookupError) {
      throw new Error(emailLookupError.message);
    }

    if (emailMatchedUser) {
      const { error: updateError } = await supabase
        .from("users")
        .update({ auth_user_id: authUser.id })
        .eq("id", emailMatchedUser.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      userRecord = {
        ...emailMatchedUser,
        auth_user_id: authUser.id
      };
    }
  }

  if (!userRecord) {
    const newUserId = randomUUID();
    const { error: insertError } = await supabase.from("users").insert({
      id: newUserId,
      auth_user_id: authUser.id,
      email
    });

    if (insertError) {
      throw new Error(insertError.message);
    }

    userRecord = {
      id: newUserId,
      email,
      auth_user_id: authUser.id
    };
  }

  return {
    supabase,
    publicUserId: userRecord.id,
    email
  };
}
