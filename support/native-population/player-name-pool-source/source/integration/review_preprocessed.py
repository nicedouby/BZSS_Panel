"""Assert the actual shipping preprocessor path has one fixed tick owner."""
import json
from pathlib import Path

ticket = Path("joint-ticket.i").read_text()
control = Path("joint-control.i").read_text()
publish = Path("joint-publish.i").read_text()
install = ticket.split("static void install_probe(void) {", 1)[1]
prepare = control.split("static void control_install(void){", 1)[1].split("int warmup_control_joint_prepared", 1)[0]
dispatch = Path("integration/joint_dispatch.h").read_text()
assert "control_tick(" not in control
assert "__atomic_compare_exchange_n" not in prepare
assert "pthread_create" not in prepare
assert "nt_runtime_start" not in prepare
assert "joint_prepared_waiting_tick_owner" in prepare
assert install.count("__atomic_compare_exchange_n") == 1
assert install.index("preflight()") < install.index("nt_graph_init()") < install.index("__atomic_compare_exchange_n")
assert install.index("__atomic_compare_exchange_n") < install.index("nt_runtime_start(session_id)") < install.index("pthread_create") < install.index("warmup_control_joint_start_worker()")
assert install.count("original_tick=(tick_function)((uintptr_t)0x7e93fe0)") == 1
assert "original_slot_mismatch" in ticket
assert "warmup_control_tick_enter" in ticket and "ticket_after_tick" in ticket and "warmup_control_after_tick" in ticket
assert dispatch.count("original(engine,dt,idle);") == 1
assert dispatch.count("ticket(engine,dt,idle);") == 1
assert dispatch.count("warmup(engine,dt,idle,reentered);") == 1
assert "population-publish-lab" not in control + publish
assert "/opt/warmup-integrated-lab" not in control + publish
assert "squad-incus-bzss" in control + publish
assert "only_startup_thread" in publish
assert "86770cae6d030e37ab9e435e753e7e76ff59e6853190671627af771e02c148d5" in ticket + control + publish
assert "startup_not_single_thread" in publish
for field in ("gt_captured_ns", "census_captured_ns", "census_valid_until_ns", "admission_valid_until_ns", "publisher_last_call_ns"):
    assert field in control
print(json.dumps({"shipping_branch":"joint", "exclusive_tick_CAS":1,
                  "warmup_prepare_no_workers":True,"workers_after_all_preflight_and_CAS":True,
                  "fixed_original":"0x7e93fe0","original_ticket_warmup_each_once":True,
                  "target_hostname_marker_ELF_guards_retained":True,"game_used":False},sort_keys=True))
